'use strict';

const feedbackModel = require('../models/feedbackModel');

async function submitFeedback(req, res, next) {
  try {
    const { message, rating } = req.body;

    if (typeof message !== 'string' || !message.trim() || message.length > 1000) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'message is required and must be 1000 characters or fewer.',
      });
    }
    if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'rating must be a whole number between 1 and 5.',
      });
    }

    const feedback = await feedbackModel.createFeedback({
      userId: req.user.id,
      message: message.trim(),
      rating: rating ?? null,
    });

    res.status(201).json(feedback);
  } catch (err) {
    next(err);
  }
}

module.exports = { submitFeedback };
