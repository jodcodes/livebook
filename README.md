# Livebook

Standalone local copy of the Livebook application.

This branch is now designed to run with `Postgres + pgvector` as the backend source of truth. JSON files are no longer the intended runtime persistence layer.
Runtime filesystem state now lives under `backend/runtime/playbook/current` and `backend/runtime/playbook/history`.

## Structure

- `backend`: Rust API for playbook ingestion, chat, review queue, tabular review, evolve, and email workflows.
- `frontend/livebook-ui`: Next.js web application.
- `frontend/addin`: Microsoft Word task pane add-in.

## Local development

1. Start everything with one command:

```bash
make dev
```

That brings up Postgres with `pgvector`, then starts the backend, web app, and Word add-in together using `.env`.
`make dev` now exposes a single public gateway at `https://localhost:5001`.

Port map:

| Role | URL | Notes |
| --- | --- | --- |
| Public gateway | `https://localhost:5001` | Web UI and Word add-in during `make dev` |
| Backend | `http://127.0.0.1:5002` | Internal backend bind for `make dev` |
| Add-in internals | `http://127.0.0.1:3001` | Internal add-in dev server used by `make dev` |
| Web UI standalone | `http://localhost:3002` | Standalone Next.js dev server |
| Add-in standalone | `https://localhost:5001/taskpane.html` | Standalone add-in dev entry point |

2. Start Postgres with `pgvector` manually if you want only the database.

Preferred local path:

```bash
docker compose up -d postgres
```

Equivalent one-off Docker example:

```bash
docker run --name livebook-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=livebook \
  -p 5432:5432 \
  -d pgvector/pgvector:pg17
```

3. Copy `.env.example` or `backend/.env.docker.example` values into your shell or local env file.

Required backend variables:

- `DATABASE_URL`
- `OPENAI_API_KEY`

4. Start the backend directly:

```bash
cd backend
cargo run
```

`make logs` shows the Postgres container logs, and `make down` stops and removes the Dockerized database stack.

Manual paths still work if you want to run each service directly:

```bash
cd frontend/livebook-ui
npm install
npm run dev
```

```bash
cd frontend/addin
npm install
npm run dev
```

The separate `make web` and `make addin` targets still exist if you want to start those services independently.
See `frontend/livebook-ui/README.md` and `frontend/addin/README.md` for the standalone service defaults.

Default local URLs when using `make dev`:

- Web UI: `https://localhost:5001/`
- Backend API: `https://localhost:5001/api/question`
- Word add-in task pane: `https://localhost:5001/taskpane.html`

## Configuration

Key backend settings live in one place now:

- `DATABASE_URL`: required. Backend startup fails without it.
- `OPENAI_API_KEY`: required for embeddings and model-backed answers.
- `OPENAI_MODEL`: answer model for `/question`.
- `OPENAI_EMBEDDING_MODEL`: embedding model for approved clauses.
- `OPENAI_EMBEDDING_DIMENSIONS`: must match the configured embedding model.
- `LIVEBOOK_BACKEND_HOST` / `LIVEBOOK_BACKEND_PORT`: backend bind address. `make dev` runs the backend internally on `127.0.0.1:5002` and exposes it through the `5001` gateway.
- `ESCALATION_NOTIFICATION_MODE`: `mocked` or `sent`.

Local actor placeholders are config-driven:

- Backend defaults use `LIVEBOOK_DEFAULT_*`.
- Web UI defaults use `NEXT_PUBLIC_LIVEBOOK_DEFAULT_*`.

Frontend proxy/build overrides remain available:

- `LIVEBOOK_BACKEND_URL`
- `NEXT_PUBLIC_AGENTATION_ENDPOINT`
- `VITE_LIVEBOOK_API_URL`
