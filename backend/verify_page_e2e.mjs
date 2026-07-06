// Throwaway: replicate the ReportIssuePage request contract against the live
// backend (same endpoint + multipart field names) for the 400/201/409 flows.
import 'dotenv/config';
import pg from 'pg';

const BASE = 'http://localhost:5000/api/incidents';
const token = process.env.TOKEN;
if (!token) { console.error('No TOKEN'); process.exit(1); }
const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const userId = payload.sub;
const email = payload.email;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// Mirror exactly what ReportIssuePage's handleSubmit builds.
function pagePost({ title, description, block, unit, withPhoto }) {
  const fd = new FormData();
  if (title !== undefined) fd.append('title', title);
  fd.append('description', description ?? '');
  if (block !== undefined) fd.append('location_block', block);
  if (unit) fd.append('location_unit', unit);
  if (withPhoto) fd.append('photo', new Blob([png], { type: 'image/png' }), 'defect.png');
  return fetch(BASE, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
}

async function show(label, res) {
  const body = await res.json().catch(() => ({}));
  console.log(`\n[${label}] HTTP ${res.status}  code=${body.code ?? '-'}`);
  return body;
}

async function main() {
  await pool.query('DELETE FROM incidents WHERE resident_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.query(`INSERT INTO users (id, email, full_name, role, status) VALUES ($1,$2,$3,'resident','active')`, [userId, email, 'UC1 Tester']);
  console.log('seeded resident profile for', email);

  await show('400 missing title', await pagePost({ description: 'x', block: '44A' }));

  const created = await show('201 submit w/ photo', await pagePost({ title: 'Lift button broken at Level 3', description: 'Lift button 3 is stuck and does not respond', block: '44A', unit: '12-05', withPhoto: true }));
  console.log('   category:', created.category, '| ai_priority_score:', created.ai_priority_score, '| status:', created.status, '| location_block:', created.location_block, '| location_unit:', created.location_unit, '| photo_url set:', Boolean(created.photo_url));

  await show('409 duplicate title', await pagePost({ title: 'Lift button broken at Level 3', description: 'again', block: '44A' }));

  await pool.query('DELETE FROM incidents WHERE resident_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  console.log('\ncleaned up test incidents + profile row');
}
main().catch((e) => console.error('FATAL:', e)).finally(async () => { await pool.end(); });
