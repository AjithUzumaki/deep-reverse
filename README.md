# DEEP REVERSE

A multimodal general-purpose AI assistant platform — chat, coding with
sandboxed execution, verified mathematics, vision, document intelligence,
data analysis, and (in later phases) image generation and voice.

This repo is being built in phases; see `docs/ARCHITECTURE.md` for the
full plan. **Current: Ring 1 Phase 1** — real auth, a real database, and
now real streaming chat against a live AI provider, with conversation
history that survives a reload.

## What actually works right now

- User registration / login / logout with Argon2id password hashing
- Rotating refresh tokens with reuse detection (session-family revocation
  on token theft)
- Short-lived JWT access tokens; the access token lives only in memory on
  the frontend (never localStorage), refreshed silently via the httpOnly
  cookie on page load
- Postgres schema for the full Ring 1 data model, via Alembic migration
- Conversations: create, list, rename, pin, archive, delete — scoped so a
  user can only ever see their own
- **Real streaming chat** against the Anthropic API (SSE under the hood),
  with both sides of every exchange persisted to Postgres, token usage
  recorded per message, and a provider abstraction (`packages/ai_core/`)
  so swapping or adding a provider later doesn't touch the routes or the
  frontend
- A minimal login/register/chat UI (no design system yet — that's a
  later phase) that actually works end to end
- Run Code for Python, JavaScript, Java, and C#, with common Python data,
  science, spreadsheet, and plotting libraries
- CI: lint, typecheck, migration run, unit + API tests

## What is not built yet (on purpose)

The full orchestrator (intent routing, planning, verification), tool registry,
fully isolated code sandbox, math engine, vision, document/data analysis, image
generation, web research, structured memory, and voice are all specified
in `docs/ARCHITECTURE.md` but not implemented. There are no placeholder
endpoints for them — an unbuilt feature simply doesn't exist in the API
yet, per the project's own no-fake-features rule.

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

The API's Run Code environment includes Python packages listed in
`apps/api/requirements.txt`, plus Node.js, a Java JDK, and the .NET 10 SDK in
the Docker image. For a local API outside Docker, install those language
runtimes on the host; DEEP REVERSE also checks `.tools/dotnet/dotnet.exe` for
a project-local .NET SDK.

```bash
cp .env.example .env
# generate a real secret:
python -c "import secrets; print(secrets.token_urlsafe(48))"
# paste it into .env as JWT_SECRET

# get a key from https://console.anthropic.com and paste it into .env as AI_API_KEY
# (AI_PROVIDER=anthropic and ANTHROPIC_MODEL are already set in .env.example)

docker compose up --build
```

This starts Postgres, Redis, MinIO, runs migrations, then boots the API
(`:8000`), worker, and web app (`:3000`). Open http://localhost:3000,
register an account, and start chatting — reload the page and your
conversation history is still there.

### Local project workspace (Windows)

The Docker app cannot access Windows folders or start Windows PowerShell by
itself. To let DEEP REVERSE work with a project on this computer, leave the
Docker stack running and open a second PowerShell window in this repository:

```powershell
npm run local-agent
```

Keep that window open. In DEEP REVERSE, select **Project Workspace**, choose
**Check connection**, enter the one-time pairing code shown in PowerShell,
then choose the project folder. The local agent binds only to `127.0.0.1` and
keeps access scoped to the one folder you select. It omits common secret files
and folders from the browser file list. File contents are sent to the
configured AI provider only when you attach a file to a chat message.

AI-proposed files have an **Apply file** action; review the code and confirm
the target path before writing. PowerShell blocks can be reviewed and run from
the workspace panel. Commands run as your Windows account and can access
outside the selected folder, so inspect every command before you approve it.
The local agent does not run AI commands automatically. Stop it with `Ctrl+C`
when you are done.

API docs (dev only): http://localhost:8000/docs

### Local Ollama chat fallback (optional)

Ollama runs a language model on this computer, so this fallback does not need
an AI API key or send prompts to a hosted model provider. It is text-only; image,
document, voice, and video features continue to use their configured providers.
The default local model is `qwen3:4b` (about 2.5 GB to download). The default
Docker setup can run on CPU and may be slower than a hosted model.

With Docker Desktop running, start the local model service and download the
model once:

```powershell
docker compose --profile local-ai up -d
docker compose exec ollama ollama pull qwen3:4b
```

The API tries Ollama first when Gemini is rate-limited, then Groq if
`GROQ_API_KEY` is configured. The model data stays in the `ollama_data` Docker
volume. Stop the optional service with `docker compose stop ollama`.

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
Next up: **Phase 2** — the orchestrator: intent classification, tool
registry, model routing, and task persistence. This is the piece that
turns "a chat app" into "an assistant that plans and verifies."
