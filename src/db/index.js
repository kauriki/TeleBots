'use strict';

const { Pool } = require('pg');

// Connection pool — reuses connections efficiently
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway and most cloud providers use SSL
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,             // maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * Run a parameterized query against the pool.
 * @param {string} text   - SQL query string
 * @param {Array}  params - Query parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
const query = (text, params) => pool.query(text, params);

/**
 * Test the database connection.
 * @returns {Promise<void>}
 */
const testConnection = async () => {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('[DB] ✅ Database connection established.');
  } finally {
    client.release();
  }
};

module.exports = { query, pool, testConnection };
