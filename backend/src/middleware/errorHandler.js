// global error handler, standardised JSON errors
'use strict';

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

  const status = err.statusCode || 500;
  const code = err.code || 'SERVER_ERROR';
  const message =
    status === 500 && config.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message || 'Internal server error';

  res.status(status).json({ code, message });
}

module.exports = { notFound, errorHandler };
