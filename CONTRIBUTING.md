# Contributing

Thanks for your interest in improving Livebook.

## Before you start

- Open an issue or start a discussion for large changes.
- Keep pull requests focused and easy to review.
- Do not commit secrets, proprietary documents, or customer data.

## Local setup

1. Copy values from `.env.example` into your shell or local env file.
2. Start Postgres with `docker compose up -d postgres`.
3. Run `make dev`.

## Pull request expectations

- Describe the user-facing change and why it matters.
- Include screenshots for UI changes when possible.
- Add or update tests when behavior changes.
- Document any new environment variables or setup steps.

## License

By contributing to this repository, you agree that your contributions will be
licensed under `AGPL-3.0-only`.
