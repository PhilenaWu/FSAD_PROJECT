// global error handler, standardised JSON errors
'use strict';

const multer = require('multer');
const config = require('../config/env');

// 404 for any unmatched route. Mounted after all routes.
function notFound(req, res) {
  res.status(404).json({ code: 'NOT_FOUND', message: 'Route not found' });
}

// Central error handler. Express 5 forwards both sync and async errors here.
// Always logs server-side; never leaks stack traces to clients in production.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error(err);

  // Multer rejects over-size/over-count uploads before the controller runs.
  // Surface them as client errors rather than a 500 (G4).
  if (err instanceof multer.MulterError) {
    const code = err.code === 'LIMIT_FILE_SIZE' ? 'PHOTO_TOO_LARGE' : 'VALIDATION_ERROR';
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Each photo must be 100 KB or smaller.'
        : `Upload rejected: ${err.message}.`;
    return res.status(400).json({ code, message });
  }

  const status = err.statusCode || 500;
  const code = err.code || 'SERVER_ERROR';
  const message =
    status === 500 && config.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message || 'Internal server error';

  res.status(status).json({ code, message });
}

module.exports = { notFound, errorHandler };
