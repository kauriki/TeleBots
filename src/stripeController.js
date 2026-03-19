'use strict';

/**
 * stripeController.js — Route Handlers for Stripe Connect
 *
 * POST /connect-account          → create Express account + onboarding link
 * POST /create-checkout-session  → create Checkout session for a bot purchase
 */

const db = require('../db');
const {
  createConnectedAccount,
  generateAccountLink,
  createCheckoutSession,
} = require('../services/stripeService');

// -----------------------------------------------
// POST /connect-account
// Body: { user_id, email? }
// -----------------------------------------------
const connectAccount = async (req, res) => {
  const { user_id, email } = req.body;

  if (!user_id || typeof user_id !== 'string' || user_id.trim() === '') {
    return res.status(400).json({ error: 'Field "user_id" is required.' });
  }

  try {
    // Check if user already has a connected account
    const existing = await db.query(
      `SELECT stripe_account_id FROM users WHERE id = $1`,
      [user_id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    let accountId = existing.rows[0].stripe_account_id;

    // Create a new account only if the user doesn't have one yet
    if (!accountId) {
      const account = await createConnectedAccount(email || null);
      accountId = account.id;

      await db.query(
        `UPDATE users SET stripe_account_id = $1 WHERE id = $2`,
        [accountId, user_id]
      );

      console.log(`[Stripe] ✅ Connected account created: ${accountId} for user: ${user_id}`);
    } else {
      console.log(`[Stripe] ℹ️  User ${user_id} already has account: ${accountId} — regenerating link`);
    }

    // Always generate a fresh onboarding link (they expire)
    const accountLink = await generateAccountLink(accountId);

    return res.status(201).json({
      message:    'Stripe account ready.',
      account_id: accountId,
      url:        accountLink.url,
    });
  } catch (err) {
    console.error('[Stripe] ❌ /connect-account error:', err.message);
    return res.status(500).json({ error: 'Failed to create Stripe account. Please try again.' });
  }
};

// -----------------------------------------------
// POST /create-checkout-session
// Body: { bot_id, telegram_id }
// -----------------------------------------------
const createSession = async (req, res) => {
  const { bot_id, telegram_id } = req.body;

  if (!bot_id || typeof bot_id !== 'string' || bot_id.trim() === '') {
    return res.status(400).json({ error: 'Field "bot_id" is required.' });
  }
  if (!telegram_id) {
    return res.status(400).json({ error: 'Field "telegram_id" is required.' });
  }

  try {
    // Fetch bot config + owner's Stripe account in one query
    const result = await db.query(
      `SELECT
         b.id            AS bot_id,
         b.status,
         u.stripe_account_id,
         c.produto,
         c.preco,
         c.tom,
         c.link_entrega
       FROM bots b
       JOIN users u ON u.id = b.user_id
       LEFT JOIN configs c ON c.bot_id = b.id
       WHERE b.id = $1`,
      [bot_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found.' });
    }

    const row = result.rows[0];

    if (row.status !== 'active') {
      return res.status(400).json({ error: 'Bot is not active.' });
    }

    if (!row.stripe_account_id) {
      return res.status(400).json({
        error: 'Bot owner has not completed Stripe onboarding.',
      });
    }

    const session = await createCheckoutSession(
      row.stripe_account_id,
      {
        produto:       row.produto,
        preco:         row.preco,
        link_entrega:  row.link_entrega,
      },
      telegram_id,
      bot_id
    );

    console.log(`[Stripe] 💳 Checkout session created: ${session.id} | bot: ${bot_id} | telegram: ${telegram_id}`);

    return res.status(201).json({
      session_id: session.id,
      url:        session.url,
    });
  } catch (err) {
    console.error('[Stripe] ❌ /create-checkout-session error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session. Please try again.' });
  }
};

module.exports = { connectAccount, createSession };
