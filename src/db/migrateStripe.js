'use strict';

/**
 * migrateStripe.js
 * Run: npm run db:migrate
 * Applies migration_stripe.sql (idempotent — safe to re-run).
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { pool } = require('./index');

const migrationPath = path.join(__dirname, 'migration_stripe.sql');

(async () => {
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    console.log('[DB Migrate] Running migration_stripe.sql...');
    await client.query(sql);
    console.log('[DB Migrate] ✅ Migration applied successfully.');
  } catch (err) {
    console.error('[DB Migrate] ❌ Error applying migration:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
