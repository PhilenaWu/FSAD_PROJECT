// User routes. Exposes the caller's own profile for the app header.
'use strict';

const express = require('express');

const { requireAuth } = require('../middleware/auth');
const userController = require('../controllers/userController');

const router = express.Router();

// GET /api/users/me — any authenticated user may read their own profile row.
router.get('/me', requireAuth, userController.getMe);

module.exports = router;
