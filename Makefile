.PHONY: dev postgres-up backend web addin down logs check

postgres-up:
	docker compose up -d postgres

backend:
	cd backend && set -a && . ../.env && set +a && cargo run

web:
	cd frontend/livebook-ui && npm run dev

addin:
	cd frontend/addin && npm run dev

dev: postgres-up
	@set -e; \
	trap 'kill $$backend_pid $$web_pid $$addin_pid 2>/dev/null || true' INT TERM EXIT; \
	( cd backend && set -a && . ../.env && set +a && cargo run ) & backend_pid=$$!; \
	( cd frontend/livebook-ui && npm run dev ) & web_pid=$$!; \
	( cd frontend/addin && npm run dev ) & addin_pid=$$!; \
	wait $$backend_pid $$web_pid $$addin_pid

down:
	docker compose down

logs:
	docker compose logs -f postgres

check:
	cd backend && cargo check && cargo test
