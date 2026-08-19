import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SUPABASE_TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;

if (!SUPABASE_TOKEN || !PROJECT_REF) {
  console.error(
    'Missing SUPABASE_MANAGEMENT_TOKEN or SUPABASE_PROJECT_REF. ' +
      'Set both env vars before running this script.',
  );
  process.exit(1);
}

const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const migrationsDir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

console.log(`Found ${files.length} migration files\n`);

let success = 0;
let failed = 0;

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), 'utf-8');
  process.stdout.write(`[${success + failed + 1}/${files.length}] ${file}... `);

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_TOKEN}`,
      },
      body: JSON.stringify({ query: sql }),
    });

    if (res.ok) {
      console.log('OK');
      success++;
      continue;
    }

    const text = await res.text();
    console.log(`FAILED (${res.status}): ${text.slice(0, 240)}`);
    failed++;
  } catch (err) {
    console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

console.log(`\nDone: ${success} OK, ${failed} failed out of ${files.length}`);
