'use strict';

/**
 * botManager.js — In-Memory Bot Registry
 *
 * Manages the lifecycle of Telegraf bot instances:
 *   - createBot(botData)         → instantiate and launch
 *   - stopBot(bot_id)            → stop and remove from registry
 *   - restartBot(bot_id)         → stop then recreate from DB
 *   - updateBotConfig(bot_id)    → live config update (no restart)
 *   - sendMessage(bot_id, ...)   → send a message via a running bot
 *   - getActiveBots()            → list of active bot IDs
 *   - isRunning(bot_id)          → boolean
 *
 * Registry entry: bot_id → { instance: Telegraf, config: {...}, stripe_account_id: string|null }
 */

const { Telegraf } = require('telegraf');
const { callAI }  = require('../services/aiService');
const { createCheckoutSession } = require('../services/stripeService');
const db = require('../db');

// In-memory registry
const botRegistry = new Map();

// -----------------------------------------------
// Purchase-intent keyword detection (Portuguese)
// -----------------------------------------------
const PURCHASE_KEYWORDS = [
  'quero comprar',
  'como compro',
  'quero adquirir',
  'quero pagar',
  'como pago',
  'link de pagamento',
  'link do pagamento',
  'onde pago',
  'quero o produto',
  'finalizar compra',
  'efetuar pagamento',
  'realizar pagamento',
  'como faço para comprar',
  'como faço para pagar',
];

/**
 * Returns true if the message likely signals a purchase intent.
 * @param {string} text
 * @returns {boolean}
 */
const isPurchaseIntent = (text) => {
  const lower = text.toLowerCase().trim();
  return PURCHASE_KEYWORDS.some((kw) => lower.includes(kw));
};

// -----------------------------------------------
// Attach message handlers
// -----------------------------------------------
/**
 * Register all Telegraf handlers on a bot instance.
 * @param {Telegraf} bot
 * @param {object}   config          - Initial sales config
 * @param {string}   bot_id          - For logging and session creation
 */
const attachHandlers = (bot, config, bot_id) => {

  // /start
  bot.start(async (ctx) => {
    const produto = config.produto || 'nosso produto';
    await ctx.reply(
      `👋 Olá! Seja bem-vindo!\n\n` +
      `Estou aqui para te ajudar com tudo sobre *${produto}*.\n\n` +
      `Me pergunte qualquer coisa! 😊`,
      { parse_mode: 'Markdown' }
    );
  });

  // Any text message
  bot.on('message', async (ctx) => {
    const userText = ctx.message?.text;
    if (!userText) return; // ignore non-text (stickers, media, etc.)

    const telegramId = ctx.from?.id;
    const entry      = botRegistry.get(bot_id);
    const liveConfig = entry?.config ?? config;

    try {
      // --- Purchase intent: generate Stripe checkout session ---
      if (isPurchaseIntent(userText) && entry?.stripe_account_id) {
        try {
          const session = await createCheckoutSession(
            entry.stripe_account_id,
            liveConfig,
            telegramId,
            bot_id
          );
          await ctx.reply(
            `🛒 Ótimo! Para finalizar sua compra de *${liveConfig.produto || 'nosso produto'}*, ` +
            `acesse o link abaixo:\n\n${session.url}\n\n` +
            `✅ Após o pagamento você receberá o acesso automaticamente.`,
            { parse_mode: 'Markdown' }
          );
          return;
        } catch (stripeErr) {
          console.error(`[Bot ${bot_id}] ⚠️  Stripe session error:`, stripeErr.message);
          // Fall through to AI response if Stripe fails
        }
      }

      // --- No Stripe or no purchase intent: use AI ---
      const reply = await callAI(userText, liveConfig);
      await ctx.reply(reply);

    } catch (err) {
      console.error(`[Bot ${bot_id}] ❌ Handler error:`, err.message);
      await ctx.reply('Desculpe, ocorreu um erro. Tente novamente em breve.');
    }
  });

  // Global Telegraf error guard
  bot.catch((err, ctx) => {
    console.error(`[Bot ${bot_id}] ❌ Telegraf error (${ctx?.updateType}):`, err.message);
  });
};

// -----------------------------------------------
// createBot
// -----------------------------------------------
/**
 * @param {object} botData
 * @param {string} botData.bot_id
 * @param {string} botData.bot_token
 * @param {object} botData.config
 * @param {string|null} [botData.stripe_account_id]
 */
const createBot = async (botData) => {
  const { bot_id, bot_token, config, stripe_account_id = null } = botData;

  if (botRegistry.has(bot_id)) {
    throw new Error(`Bot ${bot_id} is already running.`);
  }

  const botInstance = new Telegraf(bot_token);
  attachHandlers(botInstance, config, bot_id);

  await botInstance.launch();

  botRegistry.set(bot_id, { instance: botInstance, config, stripe_account_id });
  console.log(`[BotManager] ✅ Bot started: ${bot_id}${stripe_account_id ? ' (Stripe ✓)' : ' (Stripe ✗ — static link)'}`);
};

// -----------------------------------------------
// stopBot
// -----------------------------------------------
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

// -----------------------------------------------
// restartBot
// -----------------------------------------------
const restartBot = async (bot_id) => {
  if (botRegistry.has(bot_id)) stopBot(bot_id);

  const result = await db.query(
    `SELECT b.id, b.bot_token, u.stripe_account_id,
            c.produto, c.preco, c.tom, c.link_pagamento, c.link_entrega
     FROM bots b
     JOIN users u ON u.id = b.user_id
     LEFT JOIN configs c ON c.bot_id = b.id
     WHERE b.id = $1 AND b.status = 'active'`,
    [bot_id]
  );

  if (result.rows.length === 0) {
    throw new Error(`Bot ${bot_id} not found or inactive in database.`);
  }

  const row = result.rows[0];
  await createBot({
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
};

// -----------------------------------------------
// updateBotConfig
// -----------------------------------------------
const updateBotConfig = (bot_id, newConfig) => {
  const entry = botRegistry.get(bot_id);
  if (!entry) return;
  entry.config = { ...entry.config, ...newConfig };
  botRegistry.set(bot_id, entry);
  console.log(`[BotManager] 🔄 Config updated live for bot: ${bot_id}`);
};

// -----------------------------------------------
// sendMessage — used by the Stripe webhook handler
// -----------------------------------------------
/**
 * Send a message to a Telegram user via a running bot.
 * @param {string}        bot_id
 * @param {string|number} chatId   - Telegram user/chat ID
 * @param {string}        text
 */
const sendMessage = async (bot_id, chatId, text) => {
  const entry = botRegistry.get(bot_id);
  if (!entry) {
    console.warn(`[BotManager] ⚠️  Cannot send message — bot ${bot_id} not running.`);
    return;
  }
  await entry.instance.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
};

// -----------------------------------------------
// Utility
// -----------------------------------------------
const getActiveBots = () => [...botRegistry.keys()];
const isRunning     = (bot_id) => botRegistry.has(bot_id);

module.exports = {
  createBot,
  stopBot,
  restartBot,
  updateBotConfig,
  sendMessage,
  getActiveBots,
  isRunning,
};
