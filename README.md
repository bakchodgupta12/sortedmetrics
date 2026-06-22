# Sorted Wallet Metrics Tracker

Internal monthly KPI dashboard for the Sorted Wallet team. All metrics are
entered manually at month end. Built with Create React App (plain JavaScript),
Supabase for storage, and Recharts for charts. Deploys to Vercel.

> Status: scaffold in progress. Features are being built tab by tab.

## Stack

- **React** (Create React App), plain JavaScript — no TypeScript
- **Supabase** — Postgres database (one row per user, JSON payload)
- **Recharts** — charts
- **Vercel** — hosting

## Local development

```bash
npm install
cp .env.example .env   # then fill in your Supabase values
npm start              # http://localhost:3000
```

### Environment variables

Create a `.env` in the project root (see `.env.example`):

```
REACT_APP_SUPABASE_URL=https://your-project-ref.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-public-key
```

Both are found in the Supabase dashboard under **Project Settings → API**.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** and run [`supabase_setup.sql`](./supabase_setup.sql)
   to create the `metrics_data` table and row-level security policies.
3. Copy the project URL and anon key into your `.env`.

> Note: this is an internal tool with custom username/password auth (no
> Supabase Auth). RLS policies allow the `anon` role; access is gated in the
> client. This is acceptable for a small internal team.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import the repo in Vercel (Framework preset: **Create React App**).
3. Add the two `REACT_APP_*` environment variables in the Vercel project
   settings.
4. Deploy. `vercel.json` provides a catch-all rewrite to `/index.html`.

## Scripts

- `npm start` — dev server
- `npm run build` — production build
- `npm test` — test runner
