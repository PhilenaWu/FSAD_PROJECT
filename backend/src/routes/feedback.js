// General app feedback — sidebar "Feedback" form, any signed-in role.
'use strict';

const express = require('express');

const { requireAuth } = require('../middleware/auth');
const feedbackController = require('../controllers/feedbackController');

const router = express.Router();

// POST /api/feedback — any signed-in user can leave general app feedback.
router.post('/', requireAuth, feedbackController.submitFeedback);

module.exports = router;
