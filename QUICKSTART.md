# Quick Start

Use this if you want the app running locally as fast as possible.

## Prerequisites

- Docker
- Node.js
- Rust
- `make`

## 1. Configure environment

Copy the example values and fill in your local secrets:

```bash
cp .env.example .env
```

At minimum, set:

- `DATABASE_URL`
- `OPENAI_API_KEY`

## 2. Start Postgres

```bash
docker compose up -d postgres
```

## 3. Start Livebook

```bash
make dev
```

This starts the backend, the web app, and the Word add-in gateway together.

## 4. Open the app

- Web UI: `https://localhost:5001/`
- Backend API: `https://localhost:5001/api/question`
- Word add-in task pane: `https://localhost:5001/taskpane.html`

## 5. Run the checks

```bash
cd frontend/livebook-ui && npm run lint
cd backend && cargo check
```

## Troubleshooting

- If the web UI does not load, confirm Postgres is running and `make dev` is still active.
- If API calls fail, check that `DATABASE_URL` and `OPENAI_API_KEY` are set.
- If Word add-in pages do not load, use the HTTPS gateway URL from above.
