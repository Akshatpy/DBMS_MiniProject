// Creates (or with --reset, drops and recreates) the whole database schema.
// Usage:  npm run db:setup            -> apply schema to an empty database
//         npm run db:setup -- --reset -> DROP everything first (demonstrates DROP ... CASCADE)
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const FILES = [
  '01_extensions_types.sql',
  '02_schema.sql',
  '03_indexes.sql',
  '04_functions.sql',
  '05_triggers.sql',
  '06_views.sql',
  '07_security.sql',
];

const { OWNER_DATABASE_URL, APP_DB_PASSWORD } = process.env;
if (!OWNER_DATABASE_URL || !APP_DB_PASSWORD) {
  console.error('OWNER_DATABASE_URL and APP_DB_PASSWORD must be set (see .env.example)');
  process.exit(1);
}

const client = new pg.Client({ connectionString: OWNER_DATABASE_URL });
await client.connect();

try {
  if (process.argv.includes('--reset')) {
    console.log('Dropping schema public (CASCADE) ...');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('DROP OWNED BY shopsense_app').catch(() => {});
  }

  // Application role (least privilege). Password comes from the environment, never from source.
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shopsense_app') THEN
        CREATE ROLE shopsense_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
    END $$;`);
  await client.query(`ALTER ROLE shopsense_app PASSWORD ${client.escapeLiteral(APP_DB_PASSWORD)}`);

  for (const file of FILES) {
    const sql = fs.readFileSync(path.join('db', file), 'utf8');
    process.stdout.write(`Applying ${file} ... `);
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('ok');
  }
  console.log('Schema ready.');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\nFAILED:', err.message, err.where ?? '', err.position ? `(position ${err.position})` : '');
  process.exitCode = 1;
} finally {
  await client.end();
}
