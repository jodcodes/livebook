.PHONY: dev postgres-up backend web addin down logs check

postgres-up:
	docker compose up -d postgres

backend:
	cd backend && set -a && . ../.env && set +a && cargo run

web:
	cd frontend/livebook-ui && npm run dev

addin:
	cd frontend/addin && npm run dev

dev:
	@trap 'docker compose stop postgres >/dev/null 2>&1 || true' EXIT INT TERM; \
	node scripts/dev.mjs; status=$$?; \
	if [ $$status -eq 0 ] || [ $$status -eq 130 ] || [ $$status -eq 143 ]; then \
		exit 0; \
	fi; \
	exit $$status

down:
	docker compose down

logs:
	docker compose logs -f postgres

check:
	cd backend && cargo check && cargo test
