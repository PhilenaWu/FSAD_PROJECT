// Environment variable validation on startup
'use strict';

// Load .env only outside production. On Render (production) env vars are
// injected by the platform, so dotenv is unnecessary there.
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Core boot vars required for the base service. Feature-specific keys
// (DATABASE_URL, JWT_SECRET, Cloudinary/OpenAI/etc.) are validated here
// only once their features are implemented.
const required = [
  'FRONTEND_URL',
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `Missing required environment variable(s): ${missing.join(', ')}.\n` +
      'Copy .env.example to .env and fill them in.'
  );
  process.exit(1);
}

const config = Object.freeze({
  PORT: Number(process.env.PORT) || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  FRONTEND_URL: process.env.FRONTEND_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  // Optional (feature-gated). CRON_SECRET guards the scheduled analysis run;
  // OPENAI_API_KEY enables real risk-alert text (falls back to a template when
  // unset). Both are documented in .env.example.
  CRON_SECRET: process.env.CRON_SECRET,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
});

module.exports = config;
