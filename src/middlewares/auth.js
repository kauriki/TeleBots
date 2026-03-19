'use strict';

/**
 * auth.js — API Authentication Middleware
 *
 * Validates the Authorization header against the API_SECRET_KEY env var.
 * All protected routes must pass through this middleware.
 *
 * Expected header format:
 *   Authorization: Bearer <API_SECRET_KEY>
 */

const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header missing.' });
  }

  // Support both "Bearer <token>" and plain token
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (!token || token !== process.env.API_SECRET_KEY) {
    // Generic message — never reveal why auth failed
    return res.status(403).json({ error: 'Forbidden: invalid credentials.' });
  }

  next();
};

module.exports = { authenticate };
