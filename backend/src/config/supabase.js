// Supabase client — used only to validate user access tokens (auth.getClaims).
// All application data goes through the pg pool (see db.js), not this client.
'use strict';

const { createClient } = require('@supabase/supabase-js');
const config = require('./env');

// The publishable key carries low privileges and is all we need to validate a
// user's JWT. getClaims() verifies the token signature against the project's
// published JWKS, so no per-request call to the Auth server is made.
// We deliberately do NOT use the secret key here — least privilege.
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

module.exports = supabase;
