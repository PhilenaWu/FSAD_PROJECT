// User controller. GET /api/users/me — returns the caller's own profile row,
// plus resident self-registration and the manager approval queue.
'use strict';

const userModel = require('../models/userModel');
const emailService = require('../services/emailService');

// Blocks a registration may claim. Mirrors the frontend's placeholder BLOCKS
// list (frontend/src/utils/blocks.js) — both move to a real blocks table when
// one exists. Validated here so a hand-crafted request can't invent a block.
const BLOCKS = ['44A', '44B', '44C', '45A', '45B'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validationError(res, message) {
  return res.status(400).json({ code: 'VALIDATION_ERROR', message });
}

// Return the authenticated user's `users` row. The row id is the Supabase auth
// uid (set by requireAuth as req.user.id), so we look it up directly.
async function getMe(req, res, next) {
  try {
    const profile = await userModel.findById(req.user.id);
    if (!profile) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Profile not found' });
    }
    // UC-012: suspended accounts (expired/terminated vendors) may authenticate
    // with Supabase but are refused here — the frontend signs them out.
    if (profile.status === 'suspended') {
      return res.status(403).json({
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account is suspended. Contact the administrator.',
      });
    }
    // Self-registered residents awaiting (or refused) manager approval. In
    // practice requireAuth has already refused these with the same codes; this
    // mirrors the suspended check above so getMe is never the weaker gate.
    if (profile.status === 'pending') {
      return res.status(403).json({
        code: 'ACCOUNT_PENDING',
        message: 'Your account is awaiting manager approval.',
      });
    }
    if (profile.status === 'rejected') {
      return res.status(403).json({
        code: 'ACCOUNT_REJECTED',
        message: 'Your registration request was not approved.',
      });
    }
    res.json(profile); // raw row, per convention
  } catch (err) {
    next(err);
  }
}

// GET /api/users/inspectors — active inspectors for the UC-004 close panel's
// endorser picker. Manager-only (enforced at the route).
async function listInspectors(req, res, next) {
  try {
    res.json(await userModel.findActiveInspectors());
  } catch (err) {
    next(err);
  }
}

// Who each role is told to contact for help. A manager escalates to an admin;
// an admin's counterpart is the managers running the estate day to day; an
// inspector on site reports to a manager too. Kept as a map rather than a
// request parameter so a caller cannot enumerate arbitrary roles — a resident
// must not be able to list every manager's phone number.
const CONTACT_ROLE_FOR = {
  manager: 'admin',
  admin: 'manager',
  inspector: 'manager',
  // Item 16: a contractor's "Need help?" card dials the estate manager — the
  // person who assigned the defect. One number in a sidebar card, the same
  // counterpart an inspector already gets; no contractor-facing page lists the
  // staff directory.
  contractor: 'manager',
};

// GET /api/users/contacts — the contacts the caller is meant to reach: the
// admin numbers behind the manager's "Need help?" card, and the manager list on
// the admin and inspector contacts pages. Role-gated at the route; the role read
// here is the verified one from requireAuth, never from the request.
async function listContacts(req, res, next) {
  try {
    const role = CONTACT_ROLE_FOR[req.user.role];
    res.json(await userModel.findActiveContactsByRole(role));
  } catch (err) {
    next(err);
  }
}

// POST /api/users/register-profile — the profile half of resident
// self-registration. The browser has already created the Supabase auth user
// and is calling with that new session's token, so the identity comes from the
// verified token (req.user), never from the body: the body only carries the
// name/block/unit the person typed.
//
// role and status are not read from the request at all — createPendingResident
// writes them as SQL literals — so no request shape can register anything but
// a pending resident. The password never reaches this server; Supabase Auth
// owns it and applies its own strength rules.
async function registerProfile(req, res, next) {
  try {
    const { full_name, block_number, unit_number } = req.body;

    if (typeof full_name !== 'string' || !full_name.trim() || full_name.length > 255) {
      return validationError(res, 'full_name is required and must be 255 characters or fewer.');
    }
    // Mirrors the client-side check; the token's email is what actually gets
    // stored, so this rejects a malformed Supabase account rather than a typo.
    if (!EMAIL_RE.test(String(req.user.email ?? ''))) {
      return validationError(res, 'A valid email address is required.');
    }
    if (!BLOCKS.includes(block_number)) {
      return validationError(res, `block_number must be one of: ${BLOCKS.join(', ')}.`);
    }
    if (unit_number != null && (typeof unit_number !== 'string' || unit_number.length > 20)) {
      return validationError(res, 'unit_number must be 20 characters or fewer.');
    }

    // Re-registration attempt on an account that already has a profile. Only
    // reachable by the token's own owner, so this leaks nothing about anyone
    // else — duplicate *email* signups are refused by Supabase before this.
    const existing = await userModel.findById(req.user.id);
    if (existing) {
      return res.status(409).json({
        code: 'PROFILE_EXISTS',
        message: 'A profile already exists for this account.',
      });
    }

    const profile = await userModel.createPendingResident({
      id: req.user.id,
      email: req.user.email,
      full_name: full_name.trim(),
      block_number,
      unit_number: unit_number?.trim() || null,
    });

    res.status(201).json(profile);
  } catch (err) {
    next(err);
  }
}

// GET /api/users/pending-residents — the manager approval queue.
async function listPendingResidents(req, res, next) {
  try {
    res.json(await userModel.findPendingResidents());
  } catch (err) {
    next(err);
  }
}

// POST /api/users/pending-residents/:id/approve|reject. Only moves rows that
// are still pending residents, so this can never flip a manager, an admin, or
// an already-suspended vendor by passing their id.
async function decidePendingResident(req, res, next, status) {
  try {
    const target = await userModel.findById(req.params.id);
    if (!target || target.role !== 'resident' || target.status !== 'pending') {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'No pending resident registration with that id.',
      });
    }
    const updated = await userModel.setStatus(req.params.id, status);

    // Approval is invisible from the resident's side — nothing changes for them
    // until they happen to try logging in again — so tell them. Failures are
    // swallowed (G13): the account is approved either way, and the manager is
    // told the mail didn't go out rather than the approval being rolled back.
    let emailSent = null;
    if (status === 'active') {
      try {
        await emailService.sendResidentApprovedEmail(updated);
        emailSent = true;
      } catch (err) {
        console.error('[userController] approval email failed:', err.message);
        emailSent = false;
      }
    }

    res.json(emailSent === null ? updated : { ...updated, email_sent: emailSent });
  } catch (err) {
    next(err);
  }
}

const approveResident = (req, res, next) => decidePendingResident(req, res, next, 'active');
const rejectResident = (req, res, next) => decidePendingResident(req, res, next, 'rejected');

module.exports = {
  getMe,
  listInspectors,
  listContacts,
  registerProfile,
  listPendingResidents,
  approveResident,
  rejectResident,
};
