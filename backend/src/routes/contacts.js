// Contact directory routes — estate + emergency numbers, any signed-in role.
// Staff numbers live on the profile row instead and are served by
// GET /api/users/contacts.
'use strict';

const express = require('express');

const { requireAuth } = require('../middleware/auth');
const contactController = require('../controllers/contactController');

const router = express.Router();

// GET /api/contacts — the directory the emergency contacts page renders and
// the resident sidebar help card reads its number from.
router.get('/', requireAuth, contactController.listDirectory);

module.exports = router;
