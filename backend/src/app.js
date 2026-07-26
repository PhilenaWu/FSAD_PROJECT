// Express app setup, middleware chain, route mounting
'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const config = require('./config/env');
const rateLimiter = require('./middleware/rateLimiter');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const inspectionRoutes = require('./routes/inspections');
const liftRoutes = require('./routes/lifts');
const checklistItemRoutes = require('./routes/checklistItems');
const contractorRoutes = require('./routes/contractors');
const userRoutes = require('./routes/users');
const analyticsRoutes = require('./routes/analytics');
const recommendationRoutes = require('./routes/recommendations');
const exportRoutes = require('./routes/export');
const cvRoutes = require('./routes/cv');
const notificationRoutes = require('./routes/notifications');
const vendorRoutes = require('./routes/vendors');
const reportRoutes = require('./routes/reports');

const app = express();

// Render runs behind a proxy; trust it so rate limiting sees real client IPs.
app.set('trust proxy', 1);

// Security headers (also removes the x-powered-by header).
app.use(helmet());

// Lock CORS to the single allowed frontend origin.
app.use(cors({ origin: config.FRONTEND_URL, credentials: true }));

// Body parsing with a size cap to limit abuse.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Basic rate limiting across all routes.
app.use(rateLimiter);

// Liveness check (used by UptimeRobot).
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Feature routes (more mounted here as they land).
app.use('/api/inspections', inspectionRoutes);
app.use('/api/lifts', liftRoutes);
app.use('/api/checklist-items', checklistItemRoutes);
app.use('/api/contractors', contractorRoutes);
app.use('/api/users', userRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/cv', cvRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin/vendors', vendorRoutes);
app.use('/api/reports', reportRoutes);

// 404 + central error handler — must stay last.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
