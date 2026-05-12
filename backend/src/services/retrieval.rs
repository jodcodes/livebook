use axum::http::StatusCode;
use serde_json::{Value, json};
use tracing::warn;

use crate::{config::AppConfig, openai::missing_api_key_error, repositories::store};

pub async fn refresh_embeddings_for_playbook(playbook: &Value) -> Result<(), (StatusCode, String)> {
    let config = store::config().map_err(internal_error)?;
    let Some(api_key) = config.openai_api_key.clone() else {
        return Err(missing_api_key_error());
    };
    let Some(clauses) = playbook.as_array() else {
        return Ok(());
    };

    for clause in clauses {
        if clause
            .get("meta")
            .and_then(|meta| meta.get("review_status"))
            .and_then(Value::as_str)
            != Some("approved")
        {
            continue;
        }

        let clause_id = clause
            .get("clause_id")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "approved clause is missing clause_id".to_string(),
                )
            })?;
        let text = retrieval_text_for_clause(clause);
        let text_hash = hash_text(&text);
        match embed_text(config, &api_key, &text).await {
            Ok(embedding) => {
                store::sync_clause_embeddings(
                    clause_id,
                    &config.openai_embedding_model,
                    &text_hash,
                    embedding,
                )
                .await
                .map_err(internal_error)?;
            }
            Err((status, message)) => {
                warn!(%status, clause_id, %message, "failed to refresh clause embedding");
                store::mark_clause_embedding_stale(clause_id)
                    .await
                    .map_err(internal_error)?;
            }
        }
    }

    Ok(())
}

pub async fn retrieve_relevant_clauses(
    question: &str,
    history: &[crate::routes::question::ChatTurn],
) -> Result<Vec<Value>, (StatusCode, String)> {
    let config = store::config().map_err(internal_error)?;
    let approved = store::approved_clause_context()
        .await
        .map_err(internal_error)?;
    if approved.is_empty() {
        return Ok(Vec::new());
    }
    let Some(api_key) = config.openai_api_key.clone() else {
        return Err(missing_api_key_error());
    };

    let query = question_with_history(question, history);
    let embedding = embed_text(config, &api_key, &query).await?;
    let matches = store::retrieve_clause_matches(&embedding, 8)
        .await
        .map_err(internal_error)?;
    Ok(matches)
}

pub fn retrieval_text_for_clause(clause: &Value) -> String {
    let mut sections = vec![
        format!(
            "Clause {}",
            clause
                .get("clause_id")
                .and_then(Value::as_str)
                .unwrap_or("")
        ),
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
        for key in ["preferred", "fallback_1", "fallback_2"] {
            if let Some(text) = positions.get(key).and_then(Value::as_str) {
                sections.push(format!("{key}: {text}"));
            }
        }
    }
    if let Some(keywords) = clause.get("keywords").and_then(Value::as_array) {
        let joined = keywords
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(", ");
        if !joined.is_empty() {
            sections.push(format!("keywords: {joined}"));
        }
    }
    sections
        .into_iter()
        .filter(|section| !section.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn question_with_history(question: &str, history: &[crate::routes::question::ChatTurn]) -> String {
    let recent = history
        .iter()
        .rev()
        .take(8)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|turn| format!("{}: {}", turn.role, turn.content))
        .collect::<Vec<_>>()
        .join("\n");
    if recent.is_empty() {
        question.to_string()
    } else {
        format!("{recent}\nquestion: {question}")
    }
}

async fn embed_text(
    config: &AppConfig,
    api_key: &str,
    input: &str,
) -> Result<Vec<f32>, (StatusCode, String)> {
    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/embeddings")
        .bearer_auth(api_key)
        .json(&json!({
            "model": config.openai_embedding_model,
            "input": input,
        }))
        .send()
        .await
        .map_err(|err| {
            (
                StatusCode::BAD_GATEWAY,
                format!("failed to call OpenAI embeddings API: {err}"),
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "failed to read OpenAI embedding error body".to_string());
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("OpenAI embeddings API error ({status}): {body}"),
        ));
    }

    let payload: Value = response.json().await.map_err(|err| {
        (
            StatusCode::BAD_GATEWAY,
            format!("failed to decode embeddings response: {err}"),
        )
    })?;
    let embedding = payload
        .get("data")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("embedding"))
        .and_then(Value::as_array)
        .ok_or_else(|| {
            (
                StatusCode::BAD_GATEWAY,
                "OpenAI embeddings response was missing data[0].embedding".to_string(),
            )
        })?;

    let values = embedding
        .iter()
        .map(|value| value.as_f64().unwrap_or_default() as f32)
        .collect::<Vec<_>>();
    if values.len() != config.openai_embedding_dimensions {
        return Err((
            StatusCode::BAD_GATEWAY,
            format!(
                "embedding dimension mismatch: expected {}, got {}",
                config.openai_embedding_dimensions,
                values.len()
            ),
        ));
    }
    Ok(values)
}

fn hash_text(input: &str) -> String {
    format!("{:016x}", fnv1a_64(input.as_bytes()))
}

fn fnv1a_64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn internal_error(message: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, message)
}
