#!/usr/bin/env node
/**
 * Ensures supabase/migrations/*.sql filenames are uniquely ordered.
 * Allows letter suffixes (007b, 014c). Does not apply SQL.
 */
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve("supabase/migrations");
if (!fs.existsSync(dir)) {
  console.error("Missing supabase/migrations");
  process.exit(1);
}

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (files.length === 0) {
  console.error("No migration files found");
  process.exit(1);
}

const keys = new Map();
let failed = false;

for (const file of files) {
  const match = file.match(/^(\d+[a-z]*)_/i);
  if (!match) {
    console.error(`Migration missing numeric prefix: ${file}`);
    failed = true;
    continue;
  }
  const key = match[1].toLowerCase();
  if (keys.has(key)) {
    console.error(`Duplicate migration key ${key}: ${keys.get(key)} and ${file}`);
    failed = true;
  } else {
    keys.set(key, file);
  }
}

console.log(`OK: ${files.length} migration files`);
for (const f of files) console.log(`  - ${f}`);

if (failed) process.exit(1);
