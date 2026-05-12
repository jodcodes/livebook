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
	node scripts/dev.mjs

down:
	docker compose down

logs:
	docker compose logs -f postgres

check:
	cd backend && cargo check && cargo test
