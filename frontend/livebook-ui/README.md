# Livebook Web UI

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3002`.

The app proxies backend requests to the backend URL documented in the root
`README.md`. Start the Rust backend before using playbook, review, or evolve
flows:

```bash
cd ../../backend
cargo run
```

## Environment

- `LIVEBOOK_BACKEND_URL`: optional backend base URL override. The root `README.md` documents the current local default.
- `NEXT_PUBLIC_AGENTATION_ENDPOINT`: optional Agentation endpoint.
