'use strict';

/**
 * aiService.js — OpenAI Chat Completions Integration
 *
 * Provides callAI(message, config) which builds a dynamic sales-bot prompt
 * and returns the AI's reply. All errors are caught and surfaced as
 * a user-friendly fallback message so the bot never crashes silently.
 */

const axios = require('axios');

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-3.5-turbo'; // swap to 'gpt-4o' if needed

/**
 * Build the system prompt from a bot's configuration.
 * @param {object} config
 * @returns {string}
 */
const buildSystemPrompt = (config) => {
  const produto = config.produto || 'nosso produto';
  const preco = config.preco || 'consulte valores';
  const tom = config.tom || 'amigável e profissional';
  const linkPagamento = config.link_pagamento || '';

  return `Você é um vendedor especialista em conversão.
Produto: ${produto}
Preço: ${preco}
Tom: ${tom}
${linkPagamento ? `Link de Pagamento: ${linkPagamento}` : ''}

Seu objetivo é:
1. Responder as dúvidas do cliente de forma clara e objetiva.
2. Destacar os benefícios do produto.
3. Conduzir a conversa de forma natural até o fechamento da venda.
4. Quando o cliente demonstrar interesse em comprar, forneça o link de pagamento.
5. Nunca invente informações que não foram fornecidas.`;
};

/**
 * Call OpenAI and return the assistant's reply.
 * @param {string} userMessage - The user's message from Telegram.
 * @param {object} config      - Bot config from the database.
 * @returns {Promise<string>}  - The AI response text.
 */
const callAI = async (userMessage, config) => {
  try {
    const response = await axios.post(
      OPENAI_API_URL,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: buildSystemPrompt(config) },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 500,
        temperature: 0.7,
      },
      {
        headers: {
          // Key retrieved at call time — never stored in module scope
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000, // 15 s timeout
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error('Empty response from OpenAI.');
    return reply.trim();
  } catch (err) {
    // Do NOT log the API key or the raw axios error that may contain headers
    const errMsg = err.response
      ? `OpenAI API error ${err.response.status}: ${err.response.data?.error?.message}`
      : err.message;

    console.error('[AI] ❌ Error calling AI:', errMsg);

    // Friendly fallback so the bot's user still gets a response
    return 'Desculpe, estou com uma instabilidade no momento. Por favor, tente novamente em alguns instantes. 🙏';
  }
};

module.exports = { callAI };
