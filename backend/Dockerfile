FROM rust:1.87-bookworm AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/target/release/backend /usr/local/bin/backend

RUN mkdir -p /app/runtime/playbook/current/upload_drafts \
    /app/runtime/playbook/history \
    /app/tabular_review_uploads

EXPOSE 5002

CMD ["backend"]
