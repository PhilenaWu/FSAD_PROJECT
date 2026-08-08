// Vendor account lifecycle (UC-012). Admin onboards external vendor
// (contractor) accounts and lists them with contract status.
'use strict';

const supabase = require('../config/supabase');
const db = require('../config/db');
const userModel = require('../models/userModel');
const contractorModel = require('../models/contractorModel');
const vendorHistoryModel = require('../models/vendorHistoryModel');
const { uploadRaw } = require('../services/cloudinaryService');
const { emitToRoom } = require('../services/socketService');
const notificationService = require('../services/notificationService');

function httpError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// POST /api/admin/vendors — onboard a new vendor (multipart form-data).
// Creates the Supabase Auth login (via signUp — the project deliberately does
// not use the secret/admin key), the linked users profile row, and the
// contractors row. Contract document (optional) goes to Cloudinary /contracts.
async function onboard(req, res, next) {
  try {
    const {
      name,
      contact_email,
      brands_serviced,
      contract_start,
      contract_end,
      account_holder_name,
      job_title,
      access_reason,
      login_email,
      login_password,
    } = req.body;

    // Account-holder fields are mandatory: every login must be traceable to a
    // named person, their position, and a recorded reason for access.
    // contact_email is deliberately NOT here. It is the fallback recipient for
    // defect mail when the holder's login is suspended or missing, so it has to
    // exist — but making the admin type a second address at onboarding buys
    // nothing when the login address is already a working mailbox. Left blank it
    // defaults to login_email below, which keeps the NOT NULL column satisfied
    // and mail deliverable. An admin who wants a shared company inbox (so the
    // address outlives this individual) can still set one here or in Edit.
    const missing = ['name', 'contract_start', 'contract_end',
      'account_holder_name', 'job_title', 'access_reason',
      'login_email', 'login_password'].filter((f) => !req.body[f]);
    if (missing.length > 0) {
      return next(httpError(400, 'VALIDATION_ERROR', `Missing fields: ${missing.join(', ')}`));
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login_email)) {
      return next(httpError(400, 'VALIDATION_ERROR',
        'login_email must be a valid email address.'));
    }

    if (new Date(contract_end) <= new Date(contract_start)) {
      return next(httpError(400, 'INVALID_CONTRACT_DATES',
        'Contract end date must be after start date.'));
    }

    if (await userModel.findByEmail(login_email)) {
      return next(httpError(409, 'EMAIL_ALREADY_EXISTS',
        'An account with this email already exists.'));
    }

    // Create the auth account. The password is admin-set and admin-managed —
    // vendors do not choose or rotate their own credential.
    const { data, error } = await supabase.auth.signUp({
      email: login_email,
      password: login_password,
    });
    if (error || !data?.user) {
      return next(httpError(400, 'AUTH_SIGNUP_FAILED',
        error ? error.message : 'Could not create login account.'));
    }

    // Admin-created accounts don't need email confirmation (login_email may not
    // be a real inbox). Stamp confirmed directly so the vendor can log in now.
    await db.query(
      'UPDATE auth.users SET email_confirmed_at = NOW() WHERE id = $1 AND email_confirmed_at IS NULL',
      [data.user.id]
    );

    // Everything after the auth signUp is compensated on failure: if any DB
    // step throws, delete the just-created auth user so no orphan login exists.
    let user;
    let contractor;
    try {
      // Optional contract document (PDF/DOCX) — stored for record-keeping only.
      let contract_doc_url = null;
      if (req.file) {
        contract_doc_url = await uploadRaw(
          req.file.buffer,
          'contracts',
          req.file.originalname
        );
      }

      // Profile row (role contractor), then the contractors row, then the
      // back-reference so requireRole and contractor queries both resolve.
      user = await userModel.create({
        id: data.user.id,
        email: login_email,
        full_name: account_holder_name,
        role: 'contractor',
        job_title,
      });
      contractor = await contractorModel.createVendor({
        name,
        // The onboarding form no longer asks for either of these. A lift
        // vendor's name generally carries the make it services ("Otis Service
        // SG", "KONE Maintenance"), so it doubles as the capability hint the
        // manager sees on the assignment dropdown; a vendor covering makes its
        // name does not state is corrected in Edit.
        brands_serviced: brands_serviced || name,
        // Fall back to the holder's address so the column is never null and
        // defect mail always has somewhere to go — see the note on `missing`.
        contact_email: contact_email || login_email,
        user_id: user.id,
        contract_start,
        contract_end,
        contract_doc_url,
        access_reason,
      });
      await userModel.setContractorId(user.id, contractor.id);
    } catch (dbErr) {
      // Cascades to auth.identities and (via FK) any users profile row.
      await db.query('DELETE FROM auth.users WHERE id = $1', [data.user.id]);
      throw dbErr;
    }

    await vendorHistoryModel.add(contractor.id, req.user.id, 'Onboarded',
      `Contract ${contract_start} → ${contract_end}; account for ${account_holder_name} (${job_title})`);

    await notificationService.notifyEvent({
      event_type: 'vendor_onboarded',
      scope: { type: 'admins' },
      message: `Vendor "${contractor.name}" onboarded — contract to ${contract_end}.`,
      urgency: 'Informational',
      link: '/admin/vendors',
    });

    res.status(201).json({
      contractor_id: contractor.id,
      user_id: user.id,
      status: user.status,
      contract_end: contractor.contract_end,
      contract_doc_url: contractor.contract_doc_url,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/vendors — all vendors with contract status and days until
// expiry, soonest-expiring first.
async function list(req, res, next) {
  try {
    const vendors = await contractorModel.listByContractEnd();
    res.json({ data: vendors });
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/vendors/:id/renew — extend the contract with a new
// contract_end; reactivates the linked account if it was suspended.
async function renew(req, res, next) {
  try {
    const { contract_end } = req.body;
    if (!contract_end) {
      return next(httpError(400, 'VALIDATION_ERROR', 'contract_end is required.'));
    }

    const vendor = await contractorModel.findById(req.params.id);
    if (!vendor) {
      return next(httpError(404, 'NOT_FOUND', 'Vendor not found.'));
    }
    // A renewal must EXTEND the contract: compare against the current
    // contract_end when one exists (comparing only against contract_start let a
    // direct API call silently shorten an active contract), falling back to
    // contract_start for a vendor with no end date yet. Mirrors the UI's
    // renewDateInvalid guard — but the server is the enforcement.
    const currentBound = vendor.contract_end ?? vendor.contract_start;
    if (currentBound && new Date(contract_end) <= new Date(currentBound)) {
      return next(httpError(400, 'INVALID_CONTRACT_DATES',
        'A renewal must extend the contract — the new end date must be after the current one.'));
    }

    // Optional replacement contract document (HLD §6.12) — keeps the old URL
    // when no new file is supplied (COALESCE in the model).
    let newDocUrl = null;
    if (req.file) {
      newDocUrl = await uploadRaw(req.file.buffer, 'contracts', req.file.originalname);
    }

    const updated = await contractorModel.updateContract(vendor.id, contract_end, newDocUrl);
    const user = vendor.user_id
      ? await userModel.setStatus(vendor.user_id, 'active')
      : null;

    await vendorHistoryModel.add(vendor.id, req.user.id, 'Contract Renewed',
      `New contract end: ${contract_end}${newDocUrl ? '; new contract document uploaded' : ''}`);

    await notificationService.notifyEvent({
      event_type: 'vendor_renewed',
      scope: { type: 'admins' },
      message: `Vendor "${vendor.name}" contract renewed to ${contract_end}.`,
      urgency: 'Informational',
      link: '/admin/vendors',
    });
    // A renewal reactivates a suspended account, which the vendor should know
    // about — they may have been locked out until now.
    if (user && vendor.user_id) {
      await notificationService.notifyEvent({
        event_type: 'vendor_renewed',
        scope: {
          type: 'users',
          user_ids: [vendor.user_id],
          rooms: [`contractor-${vendor.user_id}`],
        },
        message: `Your contract has been renewed to ${contract_end} — your account is active.`,
        urgency: 'Informational',
        link: '/contractor-inbox',
      });
    }

    res.json({
      contractor_id: updated.id,
      status: user ? user.status : null,
      contract_end: updated.contract_end,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/vendors/:id/suspend — early termination: suspend the linked
// login immediately. The vendor's open records surface for reassignment in the
// manager triage queue.
async function suspend(req, res, next) {
  try {
    const vendor = await contractorModel.findById(req.params.id);
    if (!vendor) {
      return next(httpError(404, 'NOT_FOUND', 'Vendor not found.'));
    }
    if (!vendor.user_id) {
      return next(httpError(400, 'NO_LINKED_ACCOUNT',
        'This vendor has no linked login account to suspend.'));
    }

    const user = await userModel.setStatus(vendor.user_id, 'suspended');
    await vendorHistoryModel.add(vendor.id, req.user.id, 'Suspended',
      'Early termination by admin');

    // The vendor themselves is locked out at their next login (G16) and would
    // otherwise discover it only by being refused.
    await notificationService.notifyEvent({
      event_type: 'vendor_suspended',
      scope: {
        type: 'users',
        user_ids: [vendor.user_id],
        rooms: [`contractor-${vendor.user_id}`],
      },
      message: `Your account has been suspended — contract terminated. Contact the estate administrator.`,
      urgency: 'Critical',
    });
    // Managers are the ones who reassign the vendor's open work (UC-002 Alt C),
    // so the comment above this function is only true if they are told.
    await notificationService.notifyEvent({
      event_type: 'vendor_suspended',
      scope: { type: 'managers' },
      message: `Vendor "${vendor.name}" was suspended — their open records need reassignment.`,
      urgency: 'Warning',
      link: '/inspections',
    });
    await notificationService.notifyEvent({
      event_type: 'vendor_suspended',
      scope: { type: 'admins' },
      message: `Vendor "${vendor.name}" suspended (early termination).`,
      urgency: 'Informational',
      link: '/admin/vendors',
    });

    res.json({ contractor_id: vendor.id, status: user.status });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/vendors/expiry-check — daily scheduled job (cron-guarded).
// Suspends vendors whose contract_end has passed but whose linked account is
// still active, and notifies admins over Socket.IO. (Email notification waits
// on emailService — currently a stub under UC-009.)
async function expiryCheck(req, res, next) {
  try {
    const expired = await contractorModel.findExpired();

    for (const vendor of expired) {
      await userModel.setStatus(vendor.user_id, 'suspended');
      await vendorHistoryModel.add(vendor.id, null, 'Auto-Suspended',
        `Contract expired on ${vendor.contract_end}`);
      try {
        emitToRoom('admin-room', 'vendor_expired', {
          contractor_id: vendor.id,
          name: vendor.name,
          contract_end: vendor.contract_end,
          message: `Vendor "${vendor.name}" contract expired — account suspended. Open records may need reassignment.`,
        });
      } catch (socketErr) {
        // Socket.IO not initialised (e.g. tests) — suspension still applies.
        console.error('[expiryCheck] socket emit failed:', socketErr.message);
      }

      // The socket event above only reaches an admin with the page already
      // open. These persist, so an expiry that happened overnight is still
      // waiting in the morning.
      await notificationService.notifyEvent({
        event_type: 'vendor_expired',
        scope: { type: 'admins' },
        message: `Vendor "${vendor.name}" contract expired — account suspended.`,
        urgency: 'Critical',
        link: '/admin/vendors',
      });
      await notificationService.notifyEvent({
        event_type: 'vendor_expired',
        scope: { type: 'managers' },
        message: `Vendor "${vendor.name}" expired and was suspended — their open records need reassignment.`,
        urgency: 'Warning',
        link: '/inspections',
      });
    }

    // Warn before the lapse, not only after it. UC-012 A3 shows an
    // expiring-soon banner, but nothing reached an admin who wasn't looking at
    // that page — and once the contract has expired the account is already
    // suspended, which is the outage the warning exists to prevent.
    //
    // Fired only on fixed day counts so a 30-day runway produces 5 reminders,
    // not 30. This job runs daily, so each threshold is hit at most once and no
    // "already notified" state is needed.
    const REMIND_AT_DAYS = [30, 14, 7, 3, 1];
    let expiring_soon = 0;
    try {
      const all = await contractorModel.listByContractEnd();
      for (const vendor of all) {
        if (!REMIND_AT_DAYS.includes(Number(vendor.days_until_expiry))) continue;
        expiring_soon += 1;
        await notificationService.notifyEvent({
          event_type: 'vendor_expiring_soon',
          scope: { type: 'admins' },
          message: `Vendor "${vendor.name}" contract expires in ${vendor.days_until_expiry} day(s) — renew to avoid suspension.`,
          urgency: Number(vendor.days_until_expiry) <= 7 ? 'Warning' : 'Informational',
          link: '/admin/vendors',
        });
      }
    } catch (err) {
      // A reminder failure must not affect the suspensions above.
      console.error('[expiryCheck] expiring-soon reminders failed:', err.message);
    }

    res.json({
      suspended: expired.length,
      expiring_soon,
      vendors: expired.map((v) => ({
        contractor_id: v.id,
        name: v.name,
        contract_end: v.contract_end,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/admin/vendors/:id — edit non-contract details after onboarding
// (company contact/brands, holder name/title, access reason). Contract dates
// stay in renew; login email is immutable (it is the account's identity).
async function updateDetails(req, res, next) {
  try {
    const { contact_email, brands_serviced, access_reason,
      account_holder_name, job_title } = req.body;

    if (!contact_email && !brands_serviced && !access_reason
        && !account_holder_name && !job_title) {
      return next(httpError(400, 'VALIDATION_ERROR', 'No fields to update.'));
    }

    const vendor = await contractorModel.findById(req.params.id);
    if (!vendor) {
      return next(httpError(404, 'NOT_FOUND', 'Vendor not found.'));
    }

    const updated = await contractorModel.updateDetails(vendor.id,
      { contact_email, brands_serviced, access_reason });
    if (vendor.user_id && (account_holder_name || job_title)) {
      await userModel.updateHolder(vendor.user_id,
        { full_name: account_holder_name, job_title });
    }

    const changed = [contact_email && 'contact email', brands_serviced && 'brands',
      access_reason && 'access reason', account_holder_name && 'holder name',
      job_title && 'job title'].filter(Boolean).join(', ');
    await vendorHistoryModel.add(vendor.id, req.user.id, 'Details Updated',
      `Changed: ${changed}`);

    res.json({ contractor_id: updated.id });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/vendors/:id/history — full audit trail for one vendor.
async function getHistory(req, res, next) {
  try {
    const vendor = await contractorModel.findById(req.params.id);
    if (!vendor) {
      return next(httpError(404, 'NOT_FOUND', 'Vendor not found.'));
    }
    const history = await vendorHistoryModel.listByContractor(vendor.id);
    res.json({ data: history });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  onboard, list, renew, suspend, expiryCheck, updateDetails, getHistory,
};
