# Livebook Word Online Add-in

Word Online task pane add-in for the Livebook application.

## Development

Run the app in two terminals.

Terminal 1:

```bash
cd ../../backend
cargo run
```

Terminal 2:

```bash
npm install
npm run dev
```

`npm run dev` starts only the HTTPS add-in server. For the current local port
layout, see the root `README.md`.

Open the browser smoke test at:

```text
https://localhost:5001/taskpane.html
```

The add-in uses the backend for Ask and contract review. Reading from,
commenting on, or redlining the document requires opening the pane from
Microsoft Word.

## Word Online Sideloading

1. Keep `cargo run` running from `backend`.
2. Keep `npm run dev` running from `frontend/addin`.
3. Open Word Online in the same browser.
4. Open or create a document.
5. Go to `Home > Add-ins > More Settings > Upload My Add-in`.
6. Upload `frontend/addin/manifest.xml`.

When you use `make dev` or `npm run live`, the add-in manifest points to the
gateway taskpane URL documented in the root `README.md`:

```text
https://localhost:5001/taskpane.html
```

For local Word Online testing with `npm run dev`, this works when the browser
trusts the local Office dev certificate. The add-in server uses
`office-addin-dev-certs` for that certificate.

For sharing with another machine or account, deploy the taskpane to a public
HTTPS URL and replace the localhost URLs in `manifest.xml`.

## Contract Review Workflow

The Review tab reads either the current Word selection or the whole Word
document. In Word it first tries OOXML extraction so tables are preserved as
`Table row N: cell | cell | cell` text. If OOXML is unavailable, it falls back
to Word's plain body text.

The extracted contract text is posted to:

```text
POST /tabular-review/text
```

The backend compares it clause-by-clause against the approved structured
playbook and returns outcomes, evidence, rationale, confidence, red-line count,
fallback count, and deviation score. The add-in can then find the matching
clause in Word, add native comments, and apply tracked redlines against the
document.

## Configuration

- `LIVEBOOK_BACKEND_URL`: backend URL for the dev proxy. The root `README.md` documents the current local default for standalone add-in runs. `make dev` and `npm run live` override this internally.
- `VITE_LIVEBOOK_API_URL`: optional direct API base URL baked into the built taskpane. Usually leave this empty for Word Online dev mode so `/api/*` goes through the local HTTPS proxy.
