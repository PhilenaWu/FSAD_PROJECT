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
    const missing = ['name', 'contact_email', 'contract_start', 'contract_end',
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
        brands_serviced,
        contact_email,
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
    if (vendor.contract_start && new Date(contract_end) <= new Date(vendor.contract_start)) {
      return next(httpError(400, 'INVALID_CONTRACT_DATES',
        'Contract end date must be after start date.'));
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
    }

    res.json({
      suspended: expired.length,
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
