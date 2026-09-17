# DEEP REVERSE

A multimodal general-purpose AI assistant platform — chat, coding with
sandboxed execution, verified mathematics, vision, document intelligence,
data analysis, and (in later phases) image generation and voice.

This repo is being built in phases; see `docs/ARCHITECTURE.md` for the
full plan. **This commit is Phase 0**: the scaffold. It proves the wiring
— auth, database, and the web ↔ api ↔ db path — is real, before any AI
capability is layered on top.

## What actually works right now

- User registration / login / logout with Argon2id password hashing
- Rotating refresh tokens with reuse detection (session-family revocation
  on token theft)
- Short-lived JWT access tokens
- Postgres schema for the full Ring 1 data model, via Alembic migration
- A health-check page that proves web → api → db end to end
- CI: lint, typecheck, migration run, unit + API tests

## What is not built yet (on purpose)

The orchestrator, tool registry, code sandbox, math engine, vision,
document/data analysis, image generation, web research, memory, and voice
are all specified in `docs/ARCHITECTURE.md` but not implemented. There are
no placeholder endpoints for them — an unbuilt feature simply doesn't
exist in the API yet, per the project's own no-fake-features rule.

## Architecture

```
Browser → Next.js (apps/web)
             │
        FastAPI (apps/api)  ←→  Postgres, Redis
             │
        Job Queue (Redis) → Worker (apps/worker)
```

See `docs/ARCHITECTURE.md` for the orchestrator design, database schema
rationale, sandbox hardening plan, and the full phase-by-phase roadmap.

## Local development

Requirements: Docker + Docker Compose.

```bash
cp .env.example .env
# generate a real secret:
python -c "import secrets; print(secrets.token_urlsafe(48))"
# paste it into .env as JWT_SECRET

docker compose up --build
```

This starts Postgres, Redis, MinIO, runs migrations, then boots the API
(`:8000`), worker, and web app (`:3000`). Open http://localhost:3000 — the
health-check page should show both API and Database as "connected".

API docs (dev only): http://localhost:8000/docs

### Running tests

```bash
# api
pip install -r apps/api/requirements.txt pytest pytest-asyncio ruff
pytest tests/ -q
ruff check apps/api packages

# web
cd apps/web && npm install && npm run lint && npm run typecheck
```

### Creating a migration

```bash
cd packages/db
alembic revision --autogenerate -m "describe the change"
alembic upgrade head
```

## Environment variables

See `.env.example` — every variable is documented there. Never commit a
real `.env`; secrets stay server-side and out of the web bundle (CI checks
for this).

## Project structure

```
apps/
  web/      Next.js frontend
  api/      FastAPI backend
  worker/   Background job consumer (RQ)
packages/
  db/       SQLAlchemy models + Alembic migrations
  auth/     Password hashing, JWT/refresh token logic
  shared/   Config, logging, error types (used by api + worker)
  ai_core/  Orchestrator — empty until Ring 1 Phase 2
docs/       Architecture, API, database, security docs
```

## Roadmap

See `docs/ARCHITECTURE.md` §10 for the full 10-phase Ring 1 build order.
Next up: **Phase 1** — conversations CRUD + streaming chat against a real
provider, then **Phase 2** — the orchestrator itself.
