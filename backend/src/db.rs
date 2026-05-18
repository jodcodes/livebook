use std::{str::FromStr, sync::Arc};

use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
use tokio_postgres::NoTls;

use crate::config::AppConfig;

#[derive(Clone)]
pub struct Database {
    pool: Pool,
}

impl Database {
    pub async fn connect(config: &AppConfig) -> Result<Arc<Self>, String> {
        let pg_config = tokio_postgres::Config::from_str(&config.database_url)
            .map_err(|err| format!("invalid DATABASE_URL: {err}"))?;
        let manager = Manager::from_config(
            pg_config,
            NoTls,
            ManagerConfig {
                recycling_method: RecyclingMethod::Fast,
            },
        );
        let pool = Pool::builder(manager)
            .max_size(16)
            .build()
            .map_err(|err| format!("failed to build Postgres pool: {err}"))?;
        let db = Arc::new(Self { pool });
        db.bootstrap(config).await?;
        Ok(db)
    }

    pub async fn client(&self) -> Result<deadpool_postgres::Client, String> {
        self.pool
            .get()
            .await
            .map_err(|err| format!("failed to get Postgres client: {err}"))
    }

    async fn bootstrap(&self, config: &AppConfig) -> Result<(), String> {
        let client = self.client().await?;
        client
            .batch_execute(&bootstrap_sql(config.openai_embedding_dimensions))
            .await
            .map_err(|err| format!("failed to bootstrap schema: {err}"))?;
        Ok(())
    }
}

fn bootstrap_sql(embedding_dimensions: usize) -> String {
    format!(
        r#"
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
    key TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playbooks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    playbook_type TEXT NOT NULL,
    party_name TEXT NOT NULL,
    law_type TEXT NOT NULL,
    clause_count INTEGER NOT NULL DEFAULT 0,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clauses (
    clause_id TEXT PRIMARY KEY,
    playbook_id TEXT NOT NULL,
    name TEXT NOT NULL,
    clause_type TEXT NOT NULL,
    law_type TEXT NOT NULL,
    party_name TEXT NOT NULL,
    review_status TEXT NOT NULL,
    approved BOOLEAN NOT NULL DEFAULT FALSE,
    payload JSONB NOT NULL,
    normalized_text TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clauses_playbook_id_idx ON clauses(playbook_id);
CREATE INDEX IF NOT EXISTS clauses_review_status_idx ON clauses(review_status);

CREATE TABLE IF NOT EXISTS clause_versions (
    version_id TEXT PRIMARY KEY,
    clause_id TEXT NOT NULL,
    playbook_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clause_versions_clause_id_idx ON clause_versions(clause_id);
CREATE INDEX IF NOT EXISTS clause_versions_playbook_id_idx ON clause_versions(playbook_id);

CREATE TABLE IF NOT EXISTS clause_embeddings (
    clause_id TEXT PRIMARY KEY REFERENCES clauses(clause_id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    stale BOOLEAN NOT NULL DEFAULT FALSE,
    embedding VECTOR({embedding_dimensions}) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_queries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    clause_ref TEXT NOT NULL,
    escalation_required BOOLEAN NOT NULL DEFAULT FALSE,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_queries_session_id_idx ON chat_queries(session_id);

CREATE TABLE IF NOT EXISTS escalations (
    id TEXT PRIMARY KEY,
    query_id TEXT,
    status TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_queue (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tabular_review_sessions (
    session_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tabular_review_rows (
    row_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES tabular_review_sessions(session_id) ON DELETE CASCADE,
    applied BOOLEAN NOT NULL DEFAULT FALSE,
    payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS clause_library_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    clause_type TEXT NOT NULL,
    visibility TEXT NOT NULL,
    source TEXT NOT NULL,
    search_text TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clause_library_items_clause_type_idx ON clause_library_items(clause_type);
CREATE INDEX IF NOT EXISTS clause_library_items_visibility_idx ON clause_library_items(visibility);

CREATE TABLE IF NOT EXISTS precedent_documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    visibility TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS word_review_sessions (
    session_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS word_review_actions (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES word_review_sessions(session_id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS associate_projects (
    project_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    goal TEXT NOT NULL,
    workflow TEXT,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS associate_project_actions (
    id BIGSERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES associate_projects(project_id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evolve_suggestions (
    id TEXT PRIMARY KEY,
    clause_id TEXT,
    status TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_records (
    id BIGSERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"#
    )
}
