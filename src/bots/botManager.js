'use strict';

/**
 * botManager.js — In-Memory Bot Registry
 *
 * Manages the lifecycle of Telegraf bot instances:
 *   - createBot(botData)   → instantiate and launch
 *   - stopBot(bot_id)      → stop and remove from registry
 *   - restartBot(bot_id)   → stop then recreate from DB
 *   - getActiveBots()      → list of active bot IDs
 *   - isRunning(bot_id)    → boolean
 *
 * The registry Map holds:  bot_id → { instance: Telegraf, config: {...} }
 */

const { Telegraf } = require('telegraf');
const { callAI } = require('../services/aiService');
const db = require('../db');

// In-memory registry: bot_id → { instance: Telegraf, config: object }
const botRegistry = new Map();

/**
 * Register message handlers on a Telegraf instance.
 * @param {Telegraf} bot
 * @param {object}   config  - Bot's current sales config
 * @param {string}   bot_id  - For logging
 */
const attachHandlers = (bot, config, bot_id) => {
  // /start — greeting message
  bot.start(async (ctx) => {
    const produto = config.produto || 'nosso produto';
    await ctx.reply(
      `👋 Olá! Seja bem-vindo!\n\n` +
      `Estou aqui para te ajudar com tudo sobre *${produto}*.\n\n` +
      `Me pergunte qualquer coisa! 😊`,
      { parse_mode: 'Markdown' }
    );
  });

  // Any other message → AI response
  bot.on('message', async (ctx) => {
    const userText = ctx.message.text;
    if (!userText) return; // ignore non-text messages

    try {
      // Pull the latest config from memory (may have been updated via /update-config)
      const liveConfig = botRegistry.get(bot_id)?.config ?? config;
      const reply = await callAI(userText, liveConfig);
      await ctx.reply(reply);
    } catch (err) {
      console.error(`[Bot ${bot_id}] ❌ Handler error:`, err.message);
      await ctx.reply('Desculpe, ocorreu um erro. Tente novamente em breve.');
    }
  });

  // Global error handler — prevents unhandled rejections from crashing the process
  bot.catch((err, ctx) => {
    console.error(`[Bot ${bot_id}] ❌ Telegraf error for update ${ctx.updateType}:`, err.message);
  });
};

/**
 * Create and launch a new bot.
 * @param {object} botData - { bot_id, bot_token, config }
 * @throws {Error} if the bot_id is already running
 */
const createBot = async (botData) => {
  const { bot_id, bot_token, config } = botData;

  if (botRegistry.has(bot_id)) {
    throw new Error(`Bot ${bot_id} is already running.`);
  }

  const botInstance = new Telegraf(bot_token);
  attachHandlers(botInstance, config, bot_id);

  // Launch in long-polling mode (no webhooks — simpler for Railway)
  await botInstance.launch();

  botRegistry.set(bot_id, { instance: botInstance, config });
  console.log(`[BotManager] ✅ Bot started: ${bot_id}`);
};

/**
 * Stop and remove a bot from the registry.
 * @param {string} bot_id
 */
const stopBot = (bot_id) => {
  const entry = botRegistry.get(bot_id);
  if (!entry) {
    console.warn(`[BotManager] ⚠️  Bot ${bot_id} not found in registry.`);
    return;
  }

  entry.instance.stop(`Bot ${bot_id} stopped via API`);
  botRegistry.delete(bot_id);
  console.log(`[BotManager] 🛑 Bot stopped: ${bot_id}`);
};

/**
 * Restart a bot by reloading its data from the database.
 * @param {string} bot_id
 */
const restartBot = async (bot_id) => {
  // Stop if currently running
  if (botRegistry.has(bot_id)) {
    stopBot(bot_id);
  }

  // Reload from DB
  const botResult = await db.query(
    `SELECT b.id, b.bot_token, c.produto, c.preco, c.tom, c.link_pagamento
     FROM bots b
     LEFT JOIN configs c ON c.bot_id = b.id
     WHERE b.id = $1 AND b.status = 'active'`,
    [bot_id]
  );

  if (botResult.rows.length === 0) {
    throw new Error(`Bot ${bot_id} not found or inactive in database.`);
  }

  const row = botResult.rows[0];
  await createBot({
    bot_id: row.id,
    bot_token: row.bot_token,
    config: {
      produto: row.produto,
      preco: row.preco,
      tom: row.tom,
      link_pagamento: row.link_pagamento,
    },
  });
};

/**
 * Update the in-memory config for a running bot (no restart needed).
 * @param {string} bot_id
 * @param {object} newConfig
 */
const updateBotConfig = (bot_id, newConfig) => {
  const entry = botRegistry.get(bot_id);
  if (!entry) return; // bot not running — config will be picked up on next start

  entry.config = { ...entry.config, ...newConfig };
  botRegistry.set(bot_id, entry);
  console.log(`[BotManager] 🔄 Config updated live for bot: ${bot_id}`);
};

/**
 * Returns an array of active bot IDs.
 * @returns {string[]}
 */
const getActiveBots = () => [...botRegistry.keys()];

/**
 * Check if a bot is currently running.
 * @param {string} bot_id
 * @returns {boolean}
 */
const isRunning = (bot_id) => botRegistry.has(bot_id);

module.exports = { createBot, stopBot, restartBot, updateBotConfig, getActiveBots, isRunning };
