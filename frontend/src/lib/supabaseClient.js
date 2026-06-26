// Supabase client for the browser. Used for authentication only — all app data
// is fetched from the backend REST API (which validates the token and uses pg).
//
// Only the publishable (public) key is used here; it is safe to ship to the
// browser. Row-Level Security and the backend protect actual data.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env and fill them in.'
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
