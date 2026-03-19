'use strict';

/**
 * botController.js — Route Handlers for all Bot API Endpoints
 *
 * POST /create-bot    → create & launch a new bot
 * POST /update-config → update bot config (live update if running)
 * POST /delete-bot    → stop bot and mark inactive in DB
 * GET  /bots          → list all bots for a user (no tokens)
 * GET  /status        → list all currently active bot IDs
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const botManager = require('../bots/botManager');

// -----------------------------------------------
// POST /create-bot
// -----------------------------------------------
const createBot = async (req, res) => {
  const { user_id, bot_token, config } = req.body;

  try {
    // 1. Ensure user exists (or create on first use)
    const userResult = await db.query(
      `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [user_id]
    );
    // If user_id was not a valid UUID the query would throw — that's expected

    // 2. Check for duplicate bot token for this user
    const duplicate = await db.query(
      `SELECT id FROM bots WHERE user_id = $1 AND status = 'active'`,
      [user_id]
    );
    // (Optionally check by bot_token uniqueness across all users)
    const tokenDupe = await db.query(
      `SELECT id FROM bots WHERE bot_token = $1`,
      [bot_token]
    );
    if (tokenDupe.rows.length > 0) {
      return res.status(409).json({ error: 'A bot with this token already exists.' });
    }

    // 3. Insert bot record
    const bot_id = uuidv4();
    await db.query(
      `INSERT INTO bots (id, user_id, bot_token, status) VALUES ($1, $2, $3, 'active')`,
      [bot_id, user_id, bot_token]
    );

    // 4. Insert config
    await db.query(
      `INSERT INTO configs (id, bot_id, produto, preco, tom, link_pagamento)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        uuidv4(),
        bot_id,
        config.produto || null,
        config.preco || null,
        config.tom || 'amigável e profissional',
        config.link_pagamento || null,
      ]
    );

    // 5. Launch bot in memory
    await botManager.createBot({ bot_id, bot_token, config });

    console.log(`[API] ✅ Bot created successfully. ID: ${bot_id}, User: ${user_id}`);

    return res.status(201).json({
      message: 'Bot created and launched successfully.',
      bot_id,
    });
  } catch (err) {
    console.error('[API] ❌ /create-bot error:', err.message);

    // Handle Telegraf token-rejection specifically
    if (err.message.includes('401') || err.message.includes('token')) {
      return res.status(400).json({ error: 'Invalid Telegram bot token.' });
    }

    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// -----------------------------------------------
// POST /update-config
// -----------------------------------------------
const updateConfig = async (req, res) => {
  const { bot_id, config } = req.body;

  try {
    // Verify bot exists and is active
    const botResult = await db.query(
      `SELECT id FROM bots WHERE id = $1 AND status = 'active'`,
      [bot_id]
    );
    if (botResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found or inactive.' });
    }

    // Build dynamic SET clause — only update provided fields
    const allowedFields = ['produto', 'preco', 'tom', 'link_pagamento'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const field of allowedFields) {
      if (config[field] !== undefined) {
        updates.push(`${field} = $${idx}`);
        values.push(config[field]);
        idx++;
      }
    }

    values.push(new Date());  // updated_at
    values.push(bot_id);      // WHERE clause

    await db.query(
      `UPDATE configs SET ${updates.join(', ')}, updated_at = $${idx} WHERE bot_id = $${idx + 1}`,
      values
    );

    // Live-update the in-memory config (no restart needed)
    botManager.updateBotConfig(bot_id, config);

    console.log(`[API] 🔄 Config updated for bot: ${bot_id}`);

    return res.json({ message: 'Config updated successfully.', bot_id });
  } catch (err) {
    console.error('[API] ❌ /update-config error:', err.message);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// -----------------------------------------------
// POST /delete-bot
// -----------------------------------------------
const deleteBot = async (req, res) => {
  const { bot_id } = req.body;

  try {
    // Verify bot exists
    const botResult = await db.query(
      `SELECT id FROM bots WHERE id = $1`,
      [bot_id]
    );
    if (botResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found.' });
    }

    // Stop in memory (safe even if not running)
    botManager.stopBot(bot_id);

    // Mark as inactive in DB
    await db.query(
      `UPDATE bots SET status = 'inactive' WHERE id = $1`,
      [bot_id]
    );

    console.log(`[API] 🗑️  Bot deleted: ${bot_id}`);

    return res.json({ message: 'Bot stopped and marked as inactive.', bot_id });
  } catch (err) {
    console.error('[API] ❌ /delete-bot error:', err.message);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// -----------------------------------------------
// GET /bots?user_id=xxx
// -----------------------------------------------
const listBots = async (req, res) => {
  const { user_id } = req.query;

  try {
    const result = await db.query(
      `SELECT
         b.id,
         b.user_id,
         b.status,
         b.created_at,
         c.produto,
         c.preco,
         c.tom,
         c.link_pagamento,
         c.updated_at AS config_updated_at
       FROM bots b
       LEFT JOIN configs c ON c.bot_id = b.id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC`,
      [user_id]
    );

    // NEVER return bot_token in the response
    return res.json({ user_id, bots: result.rows });
  } catch (err) {
    console.error('[API] ❌ /bots error:', err.message);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// -----------------------------------------------
// GET /status
// -----------------------------------------------
const getStatus = (_req, res) => {
  const activeBots = botManager.getActiveBots();
  return res.json({
    active_count: activeBots.length,
    active_bots: activeBots,
  });
};

module.exports = { createBot, updateConfig, deleteBot, listBots, getStatus };
