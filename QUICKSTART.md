# Quick Start

Use this if you want the app running locally as fast as possible.

## Prerequisites

- Docker

## 1. Configure environment

Copy the example values and fill in your local secrets:

```bash
cp .env.example .env
```

At minimum, set:

- `DATABASE_URL`
- `OPENAI_API_KEY`

## 2. Start Livebook

```bash
docker compose up --build
```

This starts Postgres, the Rust backend, and the Next.js web app together.

## 3. Open the app

- Web UI: `http://localhost:3002/`
- Backend API: `http://localhost:5002/question`
- Next.js backend proxy: `http://localhost:3002/api/question`

The Word add-in stays a local dev workflow and is not part of the Docker stack.

## 4. Run the checks

```bash
docker compose logs -f
```

## Troubleshooting

- If the web UI does not load, confirm `docker compose up` is still active and the images built successfully.
- If API calls fail, check that `DATABASE_URL` and `OPENAI_API_KEY` are set.
- If `3002`, `5002`, or `5432` are already in use, override them for the host: `LIVEBOOK_WEB_PORT=3003 LIVEBOOK_API_PORT=5003 docker compose up --build`.
- If you want the Word add-in, continue using the existing local `make dev` flow outside Docker.
