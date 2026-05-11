# Livebook Web UI

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The app proxies backend requests to `http://127.0.0.1:3020` by default. Start the Rust backend before using playbook, review, or evolve flows:

```bash
cd ../../backend
cargo run
```

## Environment

- `LIVEBOOK_BACKEND_URL`: optional backend base URL override.
- `NEXT_PUBLIC_AGENTATION_ENDPOINT`: optional Agentation endpoint.
