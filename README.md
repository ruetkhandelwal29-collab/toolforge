# ToolForge — AI Tool Marketplace

A global marketplace for AI-powered tools. Creators publish tools, users discover and run them.

## Stack
- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (via Supabase)
- **Auth**: Supabase Auth
- **AI**: Google Gemini (extensible to OpenAI and other providers)

## Setup

### 1. Configure environment variables
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```
Fill in: Supabase URL, Supabase keys, Gemini API key, PostgreSQL connection URL.

### 2. Run database migrations
In your Supabase SQL editor, run in order:
1. `backend/migrations/001_initial_schema.sql`
2. `backend/migrations/002_indexes.sql`
3. `backend/seeds/001_categories.sql`

### 3. Start the backend
```bash
cd backend && npm run dev
```
Runs on http://localhost:4000

### 4. Start the frontend
```bash
cd frontend && npm run dev
```
Runs on http://localhost:5173

## Architecture
See ARCHITECTURE.md for the full system design.

## Phases
- [x] Phase 1: Core infrastructure, auth, marketplace UI, tool creation, execution
- [ ] Phase 2: Full tool editor, creator analytics
- [ ] Phase 3: Reviews, ratings
- [ ] Phase 4: Search improvements, discovery
- [ ] Phase 5: Monetization (credits, Stripe)
- [ ] Phase 6: Admin panel
- [ ] Phase 7: Security hardening
- [ ] Phase 8: Testing + deployment
