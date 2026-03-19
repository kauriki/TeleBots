# Telegram SaaS Backend

Production-ready Node.js backend for a multi-tenant SaaS platform that lets users create and manage AI-powered Telegram bots.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js ≥ 18 |
| Framework | Express 4 |
| Telegram | Telegraf 4 |
| AI | OpenAI Chat Completions |
| Database | PostgreSQL (via `pg`) |
| Deployment | Railway |

---

## Quick Start

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd telegram-saas-backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values
```

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (Railway sets this automatically) |
| `DATABASE_URL` | PostgreSQL connection string |
| `API_SECRET_KEY` | Strong random secret for API auth |
| `OPENAI_API_KEY` | Your OpenAI API key |

> 💡 Generate a secret: `openssl rand -hex 32`

### 3. Initialize Database

```bash
npm run db:init
```

This applies `src/db/schema.sql` to your PostgreSQL database (creates tables if they don't exist).

### 4. Start

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

---

## API Reference

All endpoints require the header:
```
Authorization: Bearer <API_SECRET_KEY>
```

### `POST /create-bot`

Creates and immediately launches a new bot.

**Body:**
```json
{
  "user_id": "uuid-of-the-user",
  "bot_token": "123456:ABCdef...",
  "config": {
    "produto": "Curso de Inglês Online",
    "preco": "R$ 197,00",
    "tom": "animado e motivador",
    "link_pagamento": "https://checkout.example.com/curso"
  }
}
```

**Response `201`:**
```json
{ "message": "Bot created and launched successfully.", "bot_id": "uuid" }
```

---

### `POST /update-config`

Updates bot config in the database **and live in memory** (no restart needed).

**Body:**
```json
{
  "bot_id": "uuid",
  "config": { "preco": "R$ 147,00" }
}
```

---

### `POST /delete-bot`

Stops the bot and marks it as inactive.

**Body:**
```json
{ "bot_id": "uuid" }
```

---

### `GET /bots?user_id=<uuid>`

Returns all bots for a user. **Bot tokens are never returned.**

---

### `GET /status`

Returns the list of currently active (in-memory) bot IDs.

---

### `GET /`

Public health check — no auth required.

---

## Deployment on Railway

1. Create a new **Railway** project
2. Add a **PostgreSQL** plugin — Railway will set `DATABASE_URL` automatically
3. Set the remaining environment variables in the Railway dashboard:
   - `API_SECRET_KEY`
   - `OPENAI_API_KEY`
4. Deploy from your Git repository — Railway auto-detects the `npm start` script
5. Run the DB schema: open the Railway shell and run `npm run db:init`

---

## Project Structure

```
telegram-saas-backend/
├── src/
│   ├── bots/
│   │   └── botManager.js      # In-memory bot registry
│   ├── controllers/
│   │   └── botController.js   # Route handlers
│   ├── db/
│   │   ├── index.js           # pg Pool
│   │   ├── initDb.js          # Schema runner
│   │   └── schema.sql         # Table definitions
│   ├── middlewares/
│   │   ├── auth.js            # Bearer token auth
│   │   └── validate.js        # Input validation
│   ├── services/
│   │   └── aiService.js       # OpenAI integration
│   └── index.js               # Entry point
├── .env.example
├── .gitignore
└── package.json
```

---

## Security Notes

- 🔒 `bot_token` is **never** returned by any API endpoint
- 🔒 Auth failures return a generic message (no detail leakage)
- 🔒 All env vars are validated at startup — app won't start if any are missing
- 🔒 AI errors are caught and return a friendly message (no stack traces to users)
