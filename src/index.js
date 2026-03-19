'use strict';

/**
 * index.js — Application Entry Point
 *
 * Boot order:
 *  1. Load and validate environment variables
 *  2. Register Stripe webhook route (raw body — MUST be before express.json())
 *  3. Connect to the database
 *  4. Load all active bots from the database and launch them
 *  5. Start the Express API server
 */

// --- Load env vars FIRST ---
require('dotenv').config();

// -----------------------------------------------
// 1. Validate required environment variables
// -----------------------------------------------
const REQUIRED_ENVS = ['DATABASE_URL', 'API_SECRET_KEY', 'OPENAI_API_KEY'];

// Stripe vars are optional at startup (warn, don't crash)
const STRIPE_ENVS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];

const missing = REQUIRED_ENVS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`❌ FATAL: Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const missingStripe = STRIPE_ENVS.filter((key) => !process.env[key]);
if (missingStripe.length > 0) {
  console.warn(`⚠️  Stripe env vars not set: ${missingStripe.join(', ')} — Stripe features disabled.`);
}

// -----------------------------------------------
// Imports
// -----------------------------------------------
const express    = require('express');
const Stripe     = require('stripe');
const db         = require('./db');
const botManager = require('./bots/botManager');

const { authenticate }     = require('./middlewares/auth');
const {
  validateCreateBot,
  validateUpdateConfig,
  validateDeleteBot,
  validateListBots,
} = require('./middlewares/validate');
const {
  createBot, updateConfig, deleteBot, listBots, getStatus,
} = require('./controllers/botController');
const { connectAccount, createSession } = require('./controllers/stripeController');

// -----------------------------------------------
// Express App Setup
// -----------------------------------------------
const app = express();

// -----------------------------------------------
// 2. Stripe Webhook — MUST be registered BEFORE express.json()
//    Stripe requires the raw request body for signature verification.
// -----------------------------------------------
app.post(
  '/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'Stripe not configured.' });
    }

    const sig = req.headers['stripe-signature'];
    let event;

    try {
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('[Webhook] ❌ Signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook error: ${err.message}` });
    }

    // ---- Handle events ----
    if (event.type === 'checkout.session.completed') {
      const session    = event.data.object;
      const telegramId = session.metadata?.telegram_id;
      const botId      = session.metadata?.bot_id;

      console.log(`[Webhook] 💳 Payment completed — session: ${session.id} | bot: ${botId} | telegram: ${telegramId}`);

      try {
        // 1. Record payment in DB
        await db.query(
          `INSERT INTO payments (bot_id, telegram_id, stripe_session_id, amount_cents, currency, status, completed_at)
           VALUES ($1, $2, $3, $4, $5, 'completed', NOW())
           ON CONFLICT (stripe_session_id) DO UPDATE SET status = 'completed', completed_at = NOW()`,
          [
            botId,
            telegramId,
            session.id,
            session.amount_total,
            session.currency,
          ]
        );

        // 2. Notify the buyer via Telegram
        if (botId && telegramId) {
          // Fetch the delivery link from config
          const configResult = await db.query(
            `SELECT c.produto, c.link_entrega FROM configs c WHERE c.bot_id = $1`,
            [botId]
          );
          const cfg       = configResult.rows[0];
          const produto   = cfg?.produto   || 'seu produto';
          const entrega   = cfg?.link_entrega;

          const msg = entrega
            ? `✅ *Pagamento confirmado!*\n\nObrigado por adquirir *${produto}*!\n\nAcesse seu produto aqui:\n${entrega}`
            : `✅ *Pagamento confirmado!*\n\nObrigado por adquirir *${produto}*! Em breve você receberá seu acesso. 🎉`;

          await botManager.sendMessage(botId, telegramId, msg);
        }
      } catch (err) {
        console.error('[Webhook] ❌ Error processing payment:', err.message);
        // Return 200 so Stripe doesn't retry — we log and investigate manually
      }
    }

    // Always acknowledge receipt to Stripe
    return res.json({ received: true });
  }
);

// -----------------------------------------------
// Standard middleware (after webhook route)
// -----------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// -----------------------------------------------
// Health check (public)
// -----------------------------------------------
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'Telegram SaaS Backend', version: '1.1.0' });
});

// -----------------------------------------------
// Protected API routes — Bot management
// -----------------------------------------------
app.post('/create-bot',     authenticate, validateCreateBot,    createBot);
app.post('/update-config',  authenticate, validateUpdateConfig, updateConfig);
app.post('/delete-bot',     authenticate, validateDeleteBot,    deleteBot);
app.get('/bots',            authenticate, validateListBots,     listBots);
app.get('/status',          authenticate, getStatus);

// -----------------------------------------------
// Protected API routes — Stripe
// -----------------------------------------------
app.post('/connect-account',         authenticate, connectAccount);
app.post('/create-checkout-session', authenticate, createSession);

// -----------------------------------------------
// 404 + global error handler
// -----------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

app.use((err, _req, res, _next) => {
  console.error('[App] ❌ Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

// -----------------------------------------------
// Reload active bots from DB on startup
// -----------------------------------------------
const reloadActiveBots = async () => {
  console.log('[Startup] Loading active bots from database...');
  try {
    const result = await db.query(
      `SELECT b.id, b.bot_token, u.stripe_account_id,
              c.produto, c.preco, c.tom, c.link_pagamento, c.link_entrega
       FROM bots b
       JOIN users u ON u.id = b.user_id
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
          bot_id:            row.id,
          bot_token:         row.bot_token,
          stripe_account_id: row.stripe_account_id || null,
          config: {
            produto:        row.produto,
            preco:          row.preco,
            tom:            row.tom,
            link_pagamento: row.link_pagamento,
            link_entrega:   row.link_entrega,
          },
        });
      } catch (err) {
        console.error(`[Startup] ⚠️  Failed to start bot ${row.id}:`, err.message);
      }
    }

    console.log(`[Startup] ✅ ${result.rows.length} bot(s) loaded.`);
  } catch (err) {
    console.error('[Startup] ❌ Error loading bots from DB:', err.message);
  }
};

// -----------------------------------------------
// Start server
// -----------------------------------------------
const PORT = process.env.PORT || 3000;

const start = async () => {
  try {
    await db.testConnection();
    await reloadActiveBots();

    app.listen(PORT, () => {
      console.log(`[Server] 🚀 Running on port ${PORT}`);
    });
  } catch (err) {
    console.error('[Server] ❌ Fatal startup error:', err.message);
    process.exit(1);
  }
};

start();

// Graceful shutdown
process.once('SIGINT',  () => { console.log('\n[Server] SIGINT received. Shutting down...');  process.exit(0); });
process.once('SIGTERM', () => { console.log('\n[Server] SIGTERM received. Shutting down...'); process.exit(0); });
