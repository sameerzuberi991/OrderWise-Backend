import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY — copy .env.example to server/.env and fill it in.');
  process.exit(1);
}

// Catch the most common misconfig: pasting the dashboard URL instead of the
// project API URL. The Project URL lives under Settings → API and looks like
// https://<project-ref>.supabase.co — never supabase.com/dashboard/...
// (localhost is allowed for the Supabase CLI local stack and tests.)
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(url);
const isHosted = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url);
if (!isLocal && !isHosted) {
  console.error(
    `SUPABASE_URL looks wrong: "${url}"\n` +
      'It should be your Project URL from Settings → API, e.g. https://abcdefgh.supabase.co\n' +
      '(not the supabase.com/dashboard link, and not ending in a path).'
  );
  process.exit(1);
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
