'use strict';

/**
 * stripeService.js — Stripe Connect Integration
 *
 * Exposes:
 *   createConnectedAccount(email)
 *   generateAccountLink(accountId)
 *   createCheckoutSession(accountId, config, telegramId, botId)
 *
 * Multi-tenant: each operation targets the owner's Express account (stripeAccount).
 */

const Stripe = require('stripe');

// Initialise lazily so tests can run without the key set
const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set.');
  }
  return Stripe(process.env.STRIPE_SECRET_KEY);
};

// -----------------------------------------------
// createConnectedAccount
// -----------------------------------------------
/**
 * Create a Stripe Express account for a new tenant.
 * @param {string} [email] - Owner's e-mail (optional but recommended)
 * @returns {Promise<import('stripe').Stripe.Account>}
 */
const createConnectedAccount = async (email) => {
  const stripe = getStripe();
  return stripe.accounts.create({
    type: 'express',
    ...(email ? { email } : {}),
    capabilities: {
      card_payments: { requested: true },
      transfers:     { requested: true },
    },
    business_type: 'individual',
    settings: {
      payouts: { schedule: { interval: 'manual' } }, // owner controls payouts
    },
  });
};

// -----------------------------------------------
// generateAccountLink
// -----------------------------------------------
/**
 * Generate a one-time onboarding URL for a connected account.
 * @param {string} accountId - Stripe account ID (acct_xxx)
 * @returns {Promise<import('stripe').Stripe.AccountLink>}
 */
const generateAccountLink = async (accountId) => {
  const stripe  = getStripe();
  const baseUrl = process.env.APP_URL || 'https://example.com';

  return stripe.accountLinks.create({
    account:     accountId,
    refresh_url: `${baseUrl}/stripe/reauth?account_id=${accountId}`,
    return_url:  `${baseUrl}/stripe/return?account_id=${accountId}`,
    type:        'account_onboarding',
  });
};

// -----------------------------------------------
// createCheckoutSession
// -----------------------------------------------
/**
 * Parse a Brazilian price string into cents.
 * "R$ 197,00" → 19700
 * "197.50"    → 19750
 * @param {string} preco
 * @returns {number} amount in cents (minimum 100 = R$1,00)
 */
const parsePriceToCents = (preco) => {
  if (!preco) return 1000;

  // Remove currency symbol and spaces
  let cleaned = preco.replace(/[R$\s]/g, '');

  if (cleaned.includes(',')) {
    // Brazilian format: comma is always the decimal separator
    // Dots (if any) are thousands separators — remove them first
    // e.g. "1.000,00" → "1000.00"  |  "197,00" → "197.00"
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes('.')) {
    // Dot only — decide if it's decimal or thousands:
    // If there is exactly ONE dot and at most 2 digits after it → decimal  (e.g. "197.50")
    // Otherwise → thousands separator with no cents            (e.g. "1.000")
    const parts = cleaned.split('.');
    const isDecimal = parts.length === 2 && parts[1].length <= 2;
    if (!isDecimal) {
      cleaned = cleaned.replace(/\./g, ''); // strip thousands dots
    }
  }

  const value = parseFloat(cleaned);
  if (isNaN(value) || value <= 0) return 1000;
  return Math.round(value * 100);
};

/**
 * Create a Stripe Checkout session on a connected account.
 * @param {string} accountId  - Owner's Stripe account (acct_xxx)
 * @param {object} config     - Bot config { produto, preco, link_entrega }
 * @param {string|number} telegramId - Buyer's Telegram user ID
 * @param {string} botId      - UUID of the bot
 * @returns {Promise<import('stripe').Stripe.Checkout.Session>}
 */
const createCheckoutSession = async (accountId, config, telegramId, botId) => {
  const stripe      = getStripe();
  const baseUrl     = process.env.APP_URL || 'https://example.com';
  const amountCents = parsePriceToCents(config.preco);

  return stripe.checkout.sessions.create(
    {
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency:     'brl',
            product_data: { name: config.produto || 'Produto' },
            unit_amount:  amountCents,
          },
          quantity: 1,
        },
      ],
      mode:        'payment',
      success_url: config.link_entrega || `${baseUrl}/payment/success`,
      cancel_url:  `${baseUrl}/payment/cancel`,
      metadata: {
        telegram_id: String(telegramId),
        bot_id:      String(botId),
      },
    },
    // This targets the connected account — critical for multi-tenant isolation
    { stripeAccount: accountId }
  );
};

module.exports = { createConnectedAccount, generateAccountLink, createCheckoutSession, parsePriceToCents };
