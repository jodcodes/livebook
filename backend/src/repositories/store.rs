use std::sync::Arc;

use chrono::Utc;
use pgvector::Vector;
use serde_json::Value;
use tokio::sync::OnceCell;
use tokio_postgres::Row;

use crate::{config::AppConfig, db::Database};

static CONFIG: OnceCell<AppConfig> = OnceCell::const_new();
static DB: OnceCell<Arc<Database>> = OnceCell::const_new();

pub async fn init(config: AppConfig, db: Arc<Database>) -> Result<(), String> {
    CONFIG
        .set(config)
        .map_err(|_| "application config already initialized".to_string())?;
    DB.set(db)
        .map_err(|_| "database store already initialized".to_string())?;
    Ok(())
}

pub fn config() -> Result<&'static AppConfig, String> {
    CONFIG
        .get()
        .ok_or_else(|| "application config is not initialized".to_string())
}

fn db() -> Result<&'static Arc<Database>, String> {
    DB.get()
        .ok_or_else(|| "database store is not initialized".to_string())
}

pub async fn get_document(key: &str) -> Result<Option<Value>, String> {
    let client = db()?.client().await?;
    let row = client
        .query_opt("SELECT payload FROM documents WHERE key = $1", &[&key])
        .await
        .map_err(|err| format!("failed to read document `{key}`: {err}"))?;
    Ok(row.map(|row| row.get::<_, Value>(0)))
}

pub async fn put_document(key: &str, payload: &Value) -> Result<(), String> {
    let client = db()?.client().await?;
    client
        .execute(
            "INSERT INTO documents (key, payload, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key)
             DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at",
            &[&key, payload],
        )
        .await
        .map_err(|err| format!("failed to write document `{key}`: {err}"))?;
    Ok(())
}

pub async fn append_audit_record(
    entity_type: &str,
    entity_id: &str,
    action: &str,
    payload: &Value,
) -> Result<(), String> {
    let client = db()?.client().await?;
    client
        .execute(
            "INSERT INTO audit_records (entity_type, entity_id, action, payload, created_at)
             VALUES ($1, $2, $3, $4, NOW())",
            &[&entity_type, &entity_id, &action, payload],
        )
        .await
        .map_err(|err| format!("failed to write audit record: {err}"))?;
    Ok(())
}

pub async fn upsert_chat_query(
    id: &str,
    session_id: &str,
    status: &str,
    question: &str,
    answer: &str,
    clause_ref: &str,
    escalation_required: bool,
    payload: &Value,
) -> Result<(), String> {
    let client = db()?.client().await?;
    client
        .execute(
            "INSERT INTO chat_queries
             (id, session_id, status, question, answer, clause_ref, escalation_required, payload, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (id)
             DO UPDATE SET
               session_id = EXCLUDED.session_id,
               status = EXCLUDED.status,
               question = EXCLUDED.question,
               answer = EXCLUDED.answer,
               clause_ref = EXCLUDED.clause_ref,
               escalation_required = EXCLUDED.escalation_required,
               payload = EXCLUDED.payload",
            &[
                &id,
                &session_id,
                &status,
                &question,
                &answer,
                &clause_ref,
                &escalation_required,
                payload,
            ],
        )
        .await
        .map_err(|err| format!("failed to upsert chat query `{id}`: {err}"))?;
    Ok(())
}

pub async fn list_chat_queries() -> Result<Vec<Value>, String> {
    let client = db()?.client().await?;
    let rows = client
        .query(
            "SELECT payload FROM chat_queries ORDER BY created_at DESC, id DESC",
            &[],
        )
        .await
        .map_err(|err| format!("failed to list chat queries: {err}"))?;
    Ok(rows.into_iter().map(|row| row.get::<_, Value>(0)).collect())
}

pub async fn upsert_escalation(
    id: &str,
    query_id: Option<&str>,
    status: &str,
    payload: &Value,
) -> Result<(), String> {
    let client = db()?.client().await?;
    client
        .execute(
            "INSERT INTO escalations (id, query_id, status, payload, created_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (id)
             DO UPDATE SET query_id = EXCLUDED.query_id, status = EXCLUDED.status, payload = EXCLUDED.payload",
            &[&id, &query_id, &status, payload],
        )
        .await
        .map_err(|err| format!("failed to upsert escalation `{id}`: {err}"))?;
    Ok(())
}

pub async fn list_escalations() -> Result<Vec<Value>, String> {
    list_table_payloads("escalations", "created_at DESC, id DESC").await
}

pub async fn upsert_email_queue_item(
    id: &str,
    status: &str,
    payload: &Value,
) -> Result<(), String> {
    upsert_queue_payload("email_queue", id, status, payload).await
}

pub async fn list_email_queue_items() -> Result<Vec<Value>, String> {
    list_table_payloads("email_queue", "created_at DESC, id DESC").await
}

pub async fn upsert_tabular_review_session(
    session_id: &str,
    status: &str,
    payload: &Value,
) -> Result<(), String> {
    let client = db()?.client().await?;
    client
        .execute(
            "INSERT INTO tabular_review_sessions (session_id, status, payload, created_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (session_id)
             DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload",
            &[&session_id, &status, payload],
        )
        .await
        .map_err(|err| format!("failed to upsert tabular review session `{session_id}`: {err}"))?;
    Ok(())
}

pub async fn list_tabular_review_sessions() -> Result<Vec<Value>, String> {
    list_table_payloads(
        "tabular_review_sessions",
        "created_at DESC, session_id DESC",
    )
    .await
}

pub async fn upsert_tabular_review_rows(session_id: &str, rows: &[Value]) -> Result<(), String> {
    let mut client = db()?.client().await?;
    let txn = client
        .transaction()
        .await
        .map_err(|err| format!("failed to begin tabular row transaction: {err}"))?;
    txn.execute(
        "DELETE FROM tabular_review_rows WHERE session_id = $1",
        &[&session_id],
    )
    .await
    .map_err(|err| format!("failed to clear tabular rows `{session_id}`: {err}"))?;
    for payload in rows {
        let row_id = payload
            .get("row_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "tabular review row missing row_id".to_string())?;
        let applied = payload
            .get("applied")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        txn.execute(
            "INSERT INTO tabular_review_rows (row_id, session_id, applied, payload)
             VALUES ($1, $2, $3, $4)",
            &[&row_id, &session_id, &applied, payload],
        )
        .await
        .map_err(|err| format!("failed to insert tabular row `{row_id}`: {err}"))?;
    }
    txn.commit()
        .await
        .map_err(|err| format!("failed to commit tabular row transaction: {err}"))?;
    Ok(())
}

pub async fn upsert_evolve_suggestion(
    id: &str,
    clause_id: Option<&str>,
    status: &str,
    payload: &Value,
) -> Result<(), String> {
    let client = db()?.client().await?;
    client
        .execute(
            "INSERT INTO evolve_suggestions (id, clause_id, status, payload, created_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (id)
             DO UPDATE SET clause_id = EXCLUDED.clause_id, status = EXCLUDED.status, payload = EXCLUDED.payload",
            &[&id, &clause_id, &status, payload],
        )
        .await
        .map_err(|err| format!("failed to upsert evolve suggestion `{id}`: {err}"))?;
    Ok(())
}

pub async fn list_evolve_suggestions() -> Result<Vec<Value>, String> {
    list_table_payloads("evolve_suggestions", "created_at DESC, id DESC").await
}

pub async fn replace_playbook_documents(
    current: &Value,
    operation: &str,
    versions: Option<&Value>,
    raw_source_segments: Option<&Value>,
) -> Result<(), String> {
    put_document("playbook/current", current).await?;
    if let Some(versions) = versions {
        put_document("playbook/versions", versions).await?;
    }
    if let Some(raw_source_segments) = raw_source_segments {
        put_document("playbook/raw_source_segments", raw_source_segments).await?;
    }

    sync_playbooks_and_clauses(current).await?;
    append_audit_record("playbook", "current", operation, current).await?;
    Ok(())
}

pub async fn sync_clause_embeddings(
    clause_id: &str,
    model: &str,
    text_hash: &str,
    embedding: Vec<f32>,
) -> Result<(), String> {
    let client = db()?.client().await?;
    let vector = Vector::from(embedding);
    client
        .execute(
            "INSERT INTO clause_embeddings (clause_id, model, text_hash, stale, embedding, updated_at)
             VALUES ($1, $2, $3, FALSE, $4, NOW())
             ON CONFLICT (clause_id)
             DO UPDATE SET
               model = EXCLUDED.model,
               text_hash = EXCLUDED.text_hash,
               stale = FALSE,
               embedding = EXCLUDED.embedding,
               updated_at = EXCLUDED.updated_at",
            &[&clause_id, &model, &text_hash, &vector],
        )
        .await
        .map_err(|err| format!("failed to upsert clause embedding `{clause_id}`: {err}"))?;
    Ok(())
}

pub async fn mark_clause_embedding_stale(clause_id: &str) -> Result<(), String> {
    let client = db()?.client().await?;
    client
        .execute(
            "UPDATE clause_embeddings SET stale = TRUE, updated_at = NOW() WHERE clause_id = $1",
            &[&clause_id],
        )
        .await
        .map_err(|err| format!("failed to mark clause embedding stale `{clause_id}`: {err}"))?;
    Ok(())
}

pub async fn approved_clause_context() -> Result<Vec<Value>, String> {
    let client = db()?.client().await?;
    let rows = client
        .query(
            "SELECT payload FROM clauses
             WHERE approved = TRUE AND review_status = 'approved'
             ORDER BY playbook_id, clause_id",
            &[],
        )
        .await
        .map_err(|err| format!("failed to load approved clause context: {err}"))?;
    Ok(rows.into_iter().map(|row| row.get::<_, Value>(0)).collect())
}

pub async fn retrieve_clause_matches(embedding: &[f32], limit: i64) -> Result<Vec<Value>, String> {
    let client = db()?.client().await?;
    let vector = Vector::from(embedding.to_vec());
    let rows = client
        .query(
            "SELECT c.payload, 1 - (e.embedding <=> $1) AS similarity
             FROM clause_embeddings e
             JOIN clauses c ON c.clause_id = e.clause_id
             WHERE e.stale = FALSE AND c.approved = TRUE AND c.review_status = 'approved'
             ORDER BY e.embedding <=> $1
             LIMIT $2",
            &[&vector, &limit],
        )
        .await
        .map_err(|err| format!("failed to retrieve clause matches: {err}"))?;
    Ok(rows
        .into_iter()
        .map(|row| add_similarity(row))
        .collect::<Vec<_>>())
}

async fn sync_playbooks_and_clauses(current: &Value) -> Result<(), String> {
    let clauses = current
        .as_array()
        .ok_or_else(|| "playbook/current must be an array".to_string())?;
    let mut client = db()?.client().await?;
    let txn = client
        .transaction()
        .await
        .map_err(|err| format!("failed to begin playbook sync transaction: {err}"))?;
    txn.execute("DELETE FROM clause_versions", &[])
        .await
        .map_err(|err| format!("failed to clear clause versions: {err}"))?;
    txn.execute(
        "DELETE FROM clause_embeddings WHERE clause_id NOT IN (SELECT clause_id FROM clauses)",
        &[],
    )
    .await
    .ok();
    txn.execute("DELETE FROM clauses", &[])
        .await
        .map_err(|err| format!("failed to clear clauses: {err}"))?;
    txn.execute("DELETE FROM playbooks", &[])
        .await
        .map_err(|err| format!("failed to clear playbooks: {err}"))?;

    let mut playbooks = std::collections::BTreeMap::<String, Vec<Value>>::new();
    for clause in clauses {
        let clause_id = clause
            .get("clause_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "clause is missing clause_id".to_string())?;
        let playbook_id = clause
            .get("playbook_id")
            .and_then(Value::as_str)
            .unwrap_or("default");
        let version_number = clause
            .get("meta")
            .and_then(|meta| meta.get("version"))
            .and_then(Value::as_u64)
            .unwrap_or(1) as i32;
        let version_id = clause
            .get("meta")
            .and_then(|meta| meta.get("version_id"))
            .and_then(Value::as_str)
            .unwrap_or(clause_id);
        let review_status = clause
            .get("meta")
            .and_then(|meta| meta.get("review_status"))
            .and_then(Value::as_str)
            .unwrap_or("pending");
        let approved = review_status == "approved";
        let name = clause
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(clause_id);
        let clause_type = clause
            .get("clause_type")
            .and_then(Value::as_str)
            .unwrap_or("General");
        let law_type = clause
            .get("law_type")
            .and_then(Value::as_str)
            .unwrap_or("General");
        let party_name = clause
            .get("party_name")
            .and_then(Value::as_str)
            .unwrap_or("Default Counterparty");
        let normalized_text = normalized_clause_text(clause);

        txn.execute(
            "INSERT INTO clauses
             (clause_id, playbook_id, name, clause_type, law_type, party_name, review_status, approved, payload, normalized_text, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())",
            &[
                &clause_id,
                &playbook_id,
                &name,
                &clause_type,
                &law_type,
                &party_name,
                &review_status,
                &approved,
                clause,
                &normalized_text,
            ],
        )
        .await
        .map_err(|err| format!("failed to insert clause `{clause_id}`: {err}"))?;

        txn.execute(
            "INSERT INTO clause_versions
             (version_id, clause_id, playbook_id, version_number, payload, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())",
            &[
                &version_id,
                &clause_id,
                &playbook_id,
                &version_number,
                clause,
            ],
        )
        .await
        .map_err(|err| format!("failed to insert clause version `{version_id}`: {err}"))?;

        playbooks
            .entry(playbook_id.to_string())
            .or_default()
            .push(clause.clone());
    }

    for (playbook_id, clauses) in playbooks {
        let sample = clauses.first().cloned().unwrap_or(Value::Null);
        let name = sample
            .get("playbook_name")
            .and_then(Value::as_str)
            .unwrap_or("");
        let playbook_type = sample
            .get("playbook_type")
            .and_then(Value::as_str)
            .unwrap_or("opposite_party");
        let party_name = sample
            .get("party_name")
            .and_then(Value::as_str)
            .unwrap_or("");
        let law_type = sample
            .get("law_type")
            .and_then(Value::as_str)
            .unwrap_or("");
        let payload = Value::Array(clauses.clone());
        let clause_count = clauses.len() as i32;

        txn.execute(
            "INSERT INTO playbooks
             (id, name, playbook_type, party_name, law_type, clause_count, payload, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())",
            &[
                &playbook_id,
                &name,
                &playbook_type,
                &party_name,
                &law_type,
                &clause_count,
                &payload,
            ],
        )
        .await
        .map_err(|err| format!("failed to insert playbook `{playbook_id}`: {err}"))?;
    }

    txn.commit()
        .await
        .map_err(|err| format!("failed to commit playbook sync transaction: {err}"))?;
    Ok(())
}

fn normalized_clause_text(clause: &Value) -> String {
    let mut parts = vec![
        clause
            .get("clause_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        clause
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        clause
            .get("clause_type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        clause
            .get("law_type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        clause
            .get("party_name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    ];
    if let Some(positions) = clause.get("positions").and_then(Value::as_object) {
        let text = positions
            .iter()
            .map(|(key, value)| format!("{key}: {}", value.as_str().unwrap_or_default()))
            .collect::<Vec<_>>()
            .join("\n");
        if !text.is_empty() {
            parts.push(text);
        }
    }
    parts
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn add_similarity(row: Row) -> Value {
    let mut payload = row.get::<_, Value>(0);
    let similarity = row.get::<_, Option<f64>>(1).unwrap_or_default();
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "_retrieval".to_string(),
            serde_json::json!({
                "similarity": similarity,
                "scored_at": Utc::now().to_rfc3339(),
            }),
        );
    }
    payload
}

async fn upsert_queue_payload(
    table: &str,
    id: &str,
    status: &str,
    payload: &Value,
) -> Result<(), String> {
    let client = db()?.client().await?;
    let sql = format!(
        "INSERT INTO {table} (id, status, payload, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (id)
         DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload"
    );
    client
        .execute(&sql, &[&id, &status, payload])
        .await
        .map_err(|err| format!("failed to upsert `{table}` item `{id}`: {err}"))?;
    Ok(())
}

async fn list_table_payloads(table: &str, order_by: &str) -> Result<Vec<Value>, String> {
    let client = db()?.client().await?;
    let sql = format!("SELECT payload FROM {table} ORDER BY {order_by}");
    let rows = client
        .query(&sql, &[])
        .await
        .map_err(|err| format!("failed to list `{table}` payloads: {err}"))?;
    Ok(rows.into_iter().map(|row| row.get::<_, Value>(0)).collect())
}
