'use strict';

/**
 * initDb.js
 * Run this script once (npm run db:init) to create the database schema.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { pool } = require('./index');

const schemaPath = path.join(__dirname, 'schema.sql');

(async () => {
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    console.log('[DB Init] Running schema.sql...');
    await client.query(sql);
    console.log('[DB Init] ✅ Schema applied successfully.');
  } catch (err) {
    console.error('[DB Init] ❌ Error applying schema:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
