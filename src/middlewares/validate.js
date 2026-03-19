'use strict';

/**
 * validate.js — Request Validation Middleware Factories
 *
 * Each exported function returns an Express middleware that validates
 * a specific request body and rejects invalid requests with 400.
 */

const validateCreateBot = (req, res, next) => {
  const { user_id, bot_token, config } = req.body;

  if (!user_id || typeof user_id !== 'string' || user_id.trim() === '') {
    return res.status(400).json({ error: 'Field "user_id" is required.' });
  }

  if (!bot_token || typeof bot_token !== 'string' || bot_token.trim() === '') {
    return res.status(400).json({ error: 'Field "bot_token" is required.' });
  }

  // Basic Telegram bot token format: numbers:alphanumeric
  const tokenPattern = /^\d+:[A-Za-z0-9_-]{35,}$/;
  if (!tokenPattern.test(bot_token.trim())) {
    return res.status(400).json({ error: 'Field "bot_token" has an invalid Telegram token format.' });
  }

  if (!config || typeof config !== 'object') {
    return res.status(400).json({ error: 'Field "config" must be an object.' });
  }

  if (!config.produto || typeof config.produto !== 'string') {
    return res.status(400).json({ error: 'Field "config.produto" is required.' });
  }

  if (!config.preco || typeof config.preco !== 'string') {
    return res.status(400).json({ error: 'Field "config.preco" is required.' });
  }

  next();
};

const validateUpdateConfig = (req, res, next) => {
  const { bot_id, config } = req.body;

  if (!bot_id || typeof bot_id !== 'string' || bot_id.trim() === '') {
    return res.status(400).json({ error: 'Field "bot_id" is required.' });
  }

  if (!config || typeof config !== 'object') {
    return res.status(400).json({ error: 'Field "config" must be an object.' });
  }

  const allowedFields = ['produto', 'preco', 'tom', 'link_pagamento'];
  const hasAtLeastOne = allowedFields.some((f) => config[f] !== undefined);
  if (!hasAtLeastOne) {
    return res.status(400).json({
      error: `"config" must contain at least one of: ${allowedFields.join(', ')}.`,
    });
  }

  next();
};

const validateDeleteBot = (req, res, next) => {
  const { bot_id } = req.body;

  if (!bot_id || typeof bot_id !== 'string' || bot_id.trim() === '') {
    return res.status(400).json({ error: 'Field "bot_id" is required.' });
  }

  next();
};

const validateListBots = (req, res, next) => {
  const { user_id } = req.query;

  if (!user_id || typeof user_id !== 'string' || user_id.trim() === '') {
    return res.status(400).json({ error: 'Query parameter "user_id" is required.' });
  }

  next();
};

module.exports = {
  validateCreateBot,
  validateUpdateConfig,
  validateDeleteBot,
  validateListBots,
};
