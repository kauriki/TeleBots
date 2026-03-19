'use strict';

/**
 * index.js — Application Entry Point
 *
 * Boot order:
 *  1. Load and validate environment variables
 *  2. Connect to the database
 *  3. Load all active bots from the database and launch them
 *  4. Start the Express API server
 */

// --- Load env vars FIRST ---
require('dotenv').config();

// -----------------------------------------------
// 1. Validate required environment variables
// -----------------------------------------------
const REQUIRED_ENVS = ['DATABASE_URL', 'API_SECRET_KEY', 'OPENAI_API_KEY'];

const missing = REQUIRED_ENVS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`❌ FATAL: Missing required environment variables: ${missing.join(', ')}`);
  console.error('   Please set them in your .env file or Railway environment settings.');
  process.exit(1);
}

// -----------------------------------------------
// Imports (after env validation so deps can read envs)
// -----------------------------------------------
const express = require('express');
const db = require('./db');
const botManager = require('./bots/botManager');
const { authenticate } = require('./middlewares/auth');
const {
  validateCreateBot,
  validateUpdateConfig,
  validateDeleteBot,
  validateListBots,
} = require('./middlewares/validate');
const {
  createBot,
  updateConfig,
  deleteBot,
  listBots,
  getStatus,
} = require('./controllers/botController');

// -----------------------------------------------
// Express App Setup
// -----------------------------------------------
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers (minimal, no extra library needed)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// -----------------------------------------------
// Health check (public — no auth)
// -----------------------------------------------
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'Telegram SaaS Backend', version: '1.0.0' });
});

// -----------------------------------------------
// Protected API routes
// -----------------------------------------------
app.post('/create-bot', authenticate, validateCreateBot, createBot);
app.post('/update-config', authenticate, validateUpdateConfig, updateConfig);
app.post('/delete-bot', authenticate, validateDeleteBot, deleteBot);
app.get('/bots', authenticate, validateListBots, listBots);
app.get('/status', authenticate, getStatus);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[App] ❌ Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

// -----------------------------------------------
// 3. Reload active bots from DB on startup
// -----------------------------------------------
const reloadActiveBots = async () => {
  console.log('[Startup] Loading active bots from database...');
  try {
    const result = await db.query(
      `SELECT b.id, b.bot_token, c.produto, c.preco, c.tom, c.link_pagamento
       FROM bots b
       LEFT JOIN configs c ON c.bot_id = b.id
       WHERE b.status = 'active'`
    );

    if (result.rows.length === 0) {
      console.log('[Startup] No active bots found.');
      return;
    }

    for (const row of result.rows) {
      try {
        await botManager.createBot({
          bot_id: row.id,
          bot_token: row.bot_token,
          config: {
            produto: row.produto,
            preco: row.preco,
            tom: row.tom,
            link_pagamento: row.link_pagamento,
          },
        });
      } catch (err) {
        // Don't crash on a single bad bot — log and continue
        console.error(`[Startup] ⚠️  Failed to start bot ${row.id}:`, err.message);
      }
    }

    console.log(`[Startup] ✅ ${result.rows.length} bot(s) loaded.`);
  } catch (err) {
    console.error('[Startup] ❌ Error loading bots from DB:', err.message);
  }
};

// -----------------------------------------------
// 4. Start server
// -----------------------------------------------
const PORT = process.env.PORT || 3000;

const start = async () => {
  try {
    // Test DB connection
    await db.testConnection();

    // Load bots from DB
    await reloadActiveBots();

    // Start HTTP server
    app.listen(PORT, () => {
      console.log(`[Server] 🚀 Running on port ${PORT}`);
    });
  } catch (err) {
    console.error('[Server] ❌ Fatal startup error:', err.message);
    process.exit(1);
  }
};

start();

// -----------------------------------------------
// Graceful shutdown
// -----------------------------------------------
process.once('SIGINT', () => { console.log('\n[Server] SIGINT received. Shutting down...'); process.exit(0); });
process.once('SIGTERM', () => { console.log('\n[Server] SIGTERM received. Shutting down...'); process.exit(0); });
