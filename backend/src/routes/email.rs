use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::time::{Duration, sleep};
use tracing::{instrument, warn};
use utoipa::{IntoParams, ToSchema};

use crate::repositories::store;
use crate::routes::evolve::run_evolve_analysis;

#[derive(Deserialize, ToSchema)]
pub struct EmailIngestRequest {
    pub subject: String,
    pub body: String,
    pub thread: Option<String>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct EmailQueueQuery {
    pub status: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct EmailIngestResponse {
    pub id: String,
    pub duplicate: bool,
}

#[utoipa::path(
    post,
    path = "/email/ingest",
    request_body = EmailIngestRequest,
    responses(
        (status = 201, description = "Email extracted and queued.", body = EmailIngestResponse),
        (status = 200, description = "Duplicate email already queued.", body = EmailIngestResponse),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Email"
)]
#[instrument(skip(body))]
pub async fn ingest_email(
    Json(body): Json<EmailIngestRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, String)> {
    let thread = body.thread.clone().unwrap_or_default();
    let source = format!("{}\n{}\n{}", body.subject, body.body, thread);
    let raw_email_hash = format!("{:016x}", fnv1a_64(source.as_bytes()));
    let mut queue = read_queue().await?;
    if let Some(existing) = queue.iter().find(|entry| {
        entry.get("raw_email_hash").and_then(Value::as_str) == Some(raw_email_hash.as_str())
    }) {
        let id = existing
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        return Ok((StatusCode::OK, Json(json!({ "id": id, "duplicate": true }))));
    }

    let extracted = extract_email_outcome(&source).await?;
    let low_confidence = extraction_low_confidence(&extracted);
    let id = format!("EM-{}", raw_email_hash);
    let entry = json!({
        "id": id,
        "raw_email_hash": raw_email_hash,
        "subject": body.subject,
        "body": body.body,
        "extracted": extracted,
        "low_confidence": low_confidence,
        "status": "pending_review",
        "processed": true,
        "created_at": Utc::now().to_rfc3339()
    });
    queue.push(entry);
    write_queue(&queue).await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "id": id, "duplicate": false })),
    ))
}

#[utoipa::path(
    get,
    path = "/email/queue",
    params(EmailQueueQuery),
    responses(
        (status = 200, description = "Email review queue.", body = Vec<Value>),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Email"
)]
#[instrument]
pub async fn get_email_queue(
    Query(query): Query<EmailQueueQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    process_pending_queue_entries().await?;
    let status = query.status.unwrap_or_else(|| "pending_review".to_string());
    let entries: Vec<Value> = read_queue()
        .await?
        .into_iter()
        .filter(|entry| {
            status == "all" || entry.get("status").and_then(Value::as_str) == Some(status.as_str())
        })
        .collect();
    Ok(Json(Value::Array(entries)))
}

#[utoipa::path(
    post,
    path = "/email/queue/{id}/approve",
    params(("id" = String, Path, description = "Queue item ID")),
    responses(
        (status = 200, description = "Queue entry approved and written to playbook.", body = Value),
        (status = 404, description = "Queue entry not found."),
        (status = 422, description = "Extracted outcome references unknown clause."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Email"
)]
#[instrument]
pub async fn approve_email_queue(
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut queue = read_queue().await?;
    let queue_idx = queue
        .iter()
        .position(|entry| entry.get("id").and_then(Value::as_str) == Some(id.as_str()))
        .ok_or((StatusCode::NOT_FOUND, "queue entry not found".to_string()))?;
    if queue[queue_idx].get("status").and_then(Value::as_str) == Some("approved") {
        return Ok(Json(queue[queue_idx].clone()));
    }
    let entry = queue[queue_idx].clone();
    let clauses_to_apply = entry
        .get("extracted")
        .and_then(|extracted| extracted.get("clauses"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut playbook = read_playbook_array().await?;
    for extracted_clause in &clauses_to_apply {
        let clause_id = extracted_clause
            .get("clause_id")
            .and_then(Value::as_str)
            .unwrap_or("");
        if find_clause_index(&playbook, clause_id).is_err() {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("unknown clause_id `{clause_id}` in extracted outcome"),
            ));
        }
    }

    let mut applied_count = 0;
    for extracted_clause in clauses_to_apply {
        let clause_id = extracted_clause
            .get("clause_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let idx = find_clause_index(&playbook, &clause_id)?;
        let history_entry = json!({
            "contract_id": id,
            "counterparty": entry.get("extracted").and_then(|e| e.get("counterparty")).and_then(Value::as_str).unwrap_or(""),
            "outcome": extracted_clause.get("outcome").and_then(Value::as_str).unwrap_or(""),
            "jurisdiction": extracted_clause.get("jurisdiction").and_then(Value::as_str).unwrap_or(""),
            "amount": extracted_clause.get("amount").and_then(Value::as_str).unwrap_or(""),
            "escalated": extracted_clause.get("escalated").and_then(Value::as_bool).unwrap_or(false),
            "date": Utc::now().format("%Y-%m-%d").to_string(),
            "source": "email_agent",
            "email_queue_id": id,
            "clause_id": clause_id,
            "confidence": extracted_clause.get("confidence").and_then(Value::as_str).unwrap_or("low"),
            "evidence": extracted_clause.get("evidence").and_then(Value::as_str).unwrap_or(""),
            "rationale": extracted_clause.get("rationale").and_then(Value::as_str).unwrap_or("")
        });
        if append_negotiation_history_once(&mut playbook[idx], history_entry) {
            applied_count += 1;
        }
    }
    if applied_count > 0 {
        write_playbook_array(&playbook).await?;
        let _ = run_evolve_analysis().await;
    }

    queue[queue_idx]["status"] = Value::String("approved".to_string());
    queue[queue_idx]["reviewed_at"] = Value::String(Utc::now().to_rfc3339());
    queue[queue_idx]["approved_insight_count"] = Value::Number(applied_count.into());
    write_queue(&queue).await?;
    Ok(Json(queue[queue_idx].clone()))
}

#[utoipa::path(
    post,
    path = "/email/queue/{id}/reject",
    params(("id" = String, Path, description = "Queue item ID")),
    responses(
        (status = 200, description = "Queue entry rejected.", body = Value),
        (status = 404, description = "Queue entry not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Email"
)]
#[instrument]
pub async fn reject_email_queue(
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut queue = read_queue().await?;
    let queue_idx = queue
        .iter()
        .position(|entry| entry.get("id").and_then(Value::as_str) == Some(id.as_str()))
        .ok_or((StatusCode::NOT_FOUND, "queue entry not found".to_string()))?;
    queue[queue_idx]["status"] = Value::String("rejected".to_string());
    queue[queue_idx]["reviewed_at"] = Value::String(Utc::now().to_rfc3339());
    write_queue(&queue).await?;
    Ok(Json(queue[queue_idx].clone()))
}

pub async fn process_pending_queue_entries() -> Result<(), (StatusCode, String)> {
    let mut queue = read_queue().await?;
    let mut changed = false;
    for entry in &mut queue {
        if entry.get("processed").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        entry["processed"] = Value::Bool(true);
        changed = true;
    }
    if changed {
        write_queue(&queue).await?;
    }
    Ok(())
}

pub async fn run_email_processing_loop() {
    loop {
        if let Err((status, message)) = process_pending_queue_entries().await {
            warn!(%status, %message, "email background processing pass failed");
        }
        sleep(Duration::from_secs(30)).await;
    }
}

async fn extract_email_outcome(source: &str) -> Result<Value, (StatusCode, String)> {
    let playbook = read_playbook_array().await.unwrap_or_default();
    if std::env::var("OPENAI_API_KEY").is_ok() {
        match extract_email_outcome_with_openai(source, &playbook).await {
            Ok(extracted) => return Ok(extracted),
            Err((status, message)) => {
                warn!(%status, %message, "OpenAI email extraction failed; falling back to deterministic extraction");
            }
        }
    }
    Ok(extract_email_outcome_locally(source, &playbook))
}

async fn extract_email_outcome_with_openai(
    source: &str,
    playbook: &[Value],
) -> Result<Value, (StatusCode, String)> {
    let api_key = std::env::var("OPENAI_API_KEY").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "OPENAI_API_KEY is not configured".to_string(),
        )
    })?;
    let playbook_json = serde_json::to_string_pretty(playbook).unwrap_or_else(|_| "[]".to_string());
    let prompt = format!(
        "Extract negotiation outcomes from the email thread for lawyer review.\n\
         Return only JSON with this exact shape:\n\
         {{\"counterparty\":\"string\",\"clauses\":[{{\"clause_id\":\"string\",\"outcome\":\"preferred|fallback_1|fallback_2|red_line_breached\",\"confidence\":\"low|medium|high\",\"evidence\":\"short excerpt or paraphrase\",\"rationale\":\"short explanation\",\"jurisdiction\":\"string\",\"amount\":\"string\",\"escalated\":false}}]}}\n\
         Rules:\n\
         - Use clause IDs from the playbook only.\n\
         - If no clause is identifiable, return clauses: [].\n\
         - If a field is unknown, use an empty string.\n\
         - Evidence must point to text in the email thread.\n\
         - Confidence is high only when clause, outcome, and evidence are clear.\n\
         - No markdown fences.\n\n\
         PLAYBOOK:\n{playbook_json}\n\n\
         EMAIL THREAD:\n{source}"
    );

    let client = reqwest::Client::new();
    let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.5".to_string());
    let response = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "reasoning": { "effort": "low" },
            "input": prompt,
        }))
        .send()
        .await
        .map_err(|err| {
            (
                StatusCode::BAD_GATEWAY,
                format!("failed to call OpenAI API: {err}"),
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "failed to read OpenAI error body".to_string());
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("OpenAI API error ({status}): {body}"),
        ));
    }

    let value: Value = response.json().await.map_err(|err| {
        (
            StatusCode::BAD_GATEWAY,
            format!("failed to decode OpenAI response: {err}"),
        )
    })?;
    let output = extract_output_text(&value).ok_or((
        StatusCode::BAD_GATEWAY,
        "OpenAI response did not contain text output".to_string(),
    ))?;
    let parsed = serde_json::from_str(&strip_markdown_fence(&output)).map_err(|err| {
        (
            StatusCode::BAD_GATEWAY,
            format!("OpenAI output was not valid email extraction JSON: {err}"),
        )
    })?;
    Ok(normalize_email_extraction(parsed, source))
}

fn extract_email_outcome_locally(source: &str, playbook: &[Value]) -> Value {
    let lower_source = source.to_ascii_lowercase();
    let mut clauses = Vec::new();
    for clause in playbook {
        let clause_id = clause
            .get("clause_id")
            .and_then(Value::as_str)
            .unwrap_or("");
        let name = clause.get("name").and_then(Value::as_str).unwrap_or("");
        let keywords = clause
            .get("keywords")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let matches_clause_id =
            !clause_id.is_empty() && lower_source.contains(&clause_id.to_ascii_lowercase());
        let matches_name = !name.is_empty() && lower_source.contains(&name.to_ascii_lowercase());
        let matches_keyword = keywords.iter().any(|keyword| {
            keyword.as_str().is_some_and(|value| {
                !value.is_empty() && lower_source.contains(&value.to_ascii_lowercase())
            })
        });
        if matches_clause_id || matches_name || matches_keyword {
            let outcome = infer_outcome(&lower_source);
            clauses.push(json!({
                "clause_id": clause_id,
                "outcome": outcome,
                "confidence": infer_confidence(matches_clause_id, matches_name, matches_keyword, &lower_source),
                "evidence": infer_evidence(source, clause_id, name, &keywords, outcome),
                "rationale": rationale_for_outcome(outcome),
                "jurisdiction": infer_jurisdiction(source),
                "amount": "",
                "escalated": lower_source.contains("escalat")
            }));
        }
    }

    json!({
        "counterparty": infer_counterparty(source),
        "clauses": clauses
    })
}

fn normalize_email_extraction(mut extracted: Value, source: &str) -> Value {
    if !extracted.is_object() {
        return json!({
            "counterparty": infer_counterparty(source),
            "clauses": []
        });
    }

    if extracted
        .get("counterparty")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty())
    {
        extracted["counterparty"] = Value::String(infer_counterparty(source));
    }

    let Some(clauses) = extracted.get_mut("clauses").and_then(Value::as_array_mut) else {
        extracted["clauses"] = Value::Array(Vec::new());
        return extracted;
    };

    for clause in clauses {
        if clause.get("confidence").and_then(Value::as_str).is_none() {
            clause["confidence"] = Value::String("low".to_string());
        }
        if clause.get("evidence").and_then(Value::as_str).is_none() {
            clause["evidence"] = Value::String(String::new());
        }
        if clause.get("rationale").and_then(Value::as_str).is_none() {
            let outcome = clause
                .get("outcome")
                .and_then(Value::as_str)
                .unwrap_or("preferred");
            clause["rationale"] = Value::String(rationale_for_outcome(outcome).to_string());
        }
        if clause.get("jurisdiction").and_then(Value::as_str).is_none() {
            clause["jurisdiction"] = Value::String(infer_jurisdiction(source));
        }
        if clause.get("amount").and_then(Value::as_str).is_none() {
            clause["amount"] = Value::String(String::new());
        }
        if clause.get("escalated").and_then(Value::as_bool).is_none() {
            clause["escalated"] = Value::Bool(source.to_ascii_lowercase().contains("escalat"));
        }
    }

    extracted
}

fn extraction_low_confidence(extracted: &Value) -> bool {
    let counterparty_empty = extracted
        .get("counterparty")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty());
    let clauses_empty = extracted
        .get("clauses")
        .and_then(Value::as_array)
        .is_none_or(Vec::is_empty);
    let clause_field_empty = extracted
        .get("clauses")
        .and_then(Value::as_array)
        .is_some_and(|clauses| {
            clauses.iter().any(|clause| {
                clause
                    .get("clause_id")
                    .and_then(Value::as_str)
                    .is_none_or(|value| value.trim().is_empty())
                    || clause
                        .get("outcome")
                        .and_then(Value::as_str)
                        .is_none_or(|value| value.trim().is_empty())
                    || clause
                        .get("confidence")
                        .and_then(Value::as_str)
                        .is_none_or(|value| value.trim().is_empty() || value == "low")
                    || clause
                        .get("evidence")
                        .and_then(Value::as_str)
                        .is_none_or(|value| value.trim().is_empty())
            })
        });
    counterparty_empty || clauses_empty || clause_field_empty
}

fn extract_output_text(value: &Value) -> Option<String> {
    value
        .get("output_text")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| {
            value
                .get("output")
                .and_then(Value::as_array)
                .and_then(|arr| {
                    arr.iter().find_map(|item| {
                        item.get("content")
                            .and_then(Value::as_array)
                            .and_then(|content| {
                                content.iter().find_map(|part| {
                                    part.get("type")
                                        .and_then(Value::as_str)
                                        .filter(|kind| *kind == "output_text")
                                        .and_then(|_| part.get("text"))
                                        .and_then(Value::as_str)
                                        .map(str::to_owned)
                                })
                            })
                    })
                })
        })
}

fn strip_markdown_fence(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(after_start) = trimmed.strip_prefix("```json") {
        return after_start
            .trim()
            .trim_end_matches("```")
            .trim()
            .to_string();
    }
    if let Some(after_start) = trimmed.strip_prefix("```") {
        return after_start
            .trim()
            .trim_end_matches("```")
            .trim()
            .to_string();
    }
    trimmed.to_string()
}

fn infer_counterparty(source: &str) -> String {
    for marker in ["Counterparty:", "Customer:", "Client:"] {
        if let Some(after) = source.split(marker).nth(1) {
            return after.lines().next().unwrap_or("").trim().to_string();
        }
    }
    String::new()
}

fn infer_outcome(lower_source: &str) -> &'static str {
    if lower_source.contains("red line") || lower_source.contains("unlimited") {
        "red_line_breached"
    } else if lower_source.contains("fallback 2") || lower_source.contains("fallback_2") {
        "fallback_2"
    } else if lower_source.contains("fallback") || lower_source.contains("fallback_1") {
        "fallback_1"
    } else {
        "preferred"
    }
}

fn infer_confidence(
    matches_clause_id: bool,
    matches_name: bool,
    matches_keyword: bool,
    lower_source: &str,
) -> &'static str {
    let explicit_outcome = lower_source.contains("fallback")
        || lower_source.contains("red line")
        || lower_source.contains("red_line")
        || lower_source.contains("preferred");
    if matches_clause_id && explicit_outcome {
        "high"
    } else if (matches_name || matches_keyword) && explicit_outcome {
        "medium"
    } else {
        "low"
    }
}

fn infer_evidence(
    source: &str,
    clause_id: &str,
    name: &str,
    keywords: &[Value],
    outcome: &str,
) -> String {
    let lower_clause_id = clause_id.to_ascii_lowercase();
    let lower_name = name.to_ascii_lowercase();
    let lower_outcome = outcome.replace('_', " ");
    source
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .find(|line| {
            let lower_line = line.to_ascii_lowercase();
            (!lower_clause_id.is_empty() && lower_line.contains(&lower_clause_id))
                || (!lower_name.is_empty() && lower_line.contains(&lower_name))
                || lower_line.contains(&lower_outcome)
                || keywords.iter().any(|keyword| {
                    keyword.as_str().is_some_and(|value| {
                        !value.is_empty() && lower_line.contains(&value.to_ascii_lowercase())
                    })
                })
        })
        .unwrap_or("")
        .chars()
        .take(280)
        .collect()
}

fn rationale_for_outcome(outcome: &str) -> &'static str {
    match outcome {
        "red_line_breached" => "Email language appears to breach the clause red line.",
        "fallback_2" => "Email thread indicates the negotiation settled near fallback 2.",
        "fallback_1" => "Email thread indicates the negotiation settled near fallback 1.",
        _ => "Email thread appears aligned with the preferred position.",
    }
}

fn infer_jurisdiction(source: &str) -> String {
    for marker in ["Jurisdiction:", "Governing law:"] {
        if let Some(after) = source.split(marker).nth(1) {
            return after.lines().next().unwrap_or("").trim().to_string();
        }
    }
    String::new()
}

async fn read_queue() -> Result<Vec<Value>, (StatusCode, String)> {
    store::list_email_queue_items()
        .await
        .map_err(internal_error)
}

async fn write_queue(queue: &[Value]) -> Result<(), (StatusCode, String)> {
    for item in queue {
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .ok_or((
                StatusCode::INTERNAL_SERVER_ERROR,
                "email queue item is missing id".to_string(),
            ))?;
        let status = item
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("pending_review");
        store::upsert_email_queue_item(id, status, item)
            .await
            .map_err(internal_error)?;
    }
    Ok(())
}

async fn read_playbook_array() -> Result<Vec<Value>, (StatusCode, String)> {
    match store::get_document("playbook/current")
        .await
        .map_err(internal_error)?
    {
        Some(Value::Array(clauses)) => Ok(clauses),
        Some(Value::Null) | None => Ok(Vec::new()),
        Some(_) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "stored playbook/current must be an array".to_string(),
        )),
    }
}

async fn write_playbook_array(clauses: &[Value]) -> Result<(), (StatusCode, String)> {
    store::replace_playbook_documents(&Value::Array(clauses.to_vec()), "email_apply", None, None)
        .await
        .map_err(internal_error)
}

fn internal_error(message: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, message)
}

fn find_clause_index(clauses: &[Value], clause_id: &str) -> Result<usize, (StatusCode, String)> {
    clauses
        .iter()
        .position(|entry| entry.get("clause_id").and_then(Value::as_str) == Some(clause_id))
        .ok_or((
            StatusCode::UNPROCESSABLE_ENTITY,
            "clause not found".to_string(),
        ))
}

fn append_negotiation_history_once(clause: &mut Value, history_entry: Value) -> bool {
    let source = history_entry
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or("");
    let email_queue_id = history_entry
        .get("email_queue_id")
        .and_then(Value::as_str)
        .unwrap_or("");
    let contract_id = history_entry
        .get("contract_id")
        .and_then(Value::as_str)
        .unwrap_or("");
    if let Some(object) = clause.as_object_mut() {
        object
            .entry("negotiation_history".to_string())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(history) = object
            .get_mut("negotiation_history")
            .and_then(Value::as_array_mut)
        {
            let duplicate = history.iter().any(|entry| {
                entry.get("source").and_then(Value::as_str) == Some(source)
                    && entry.get("email_queue_id").and_then(Value::as_str) == Some(email_queue_id)
                    && entry.get("contract_id").and_then(Value::as_str) == Some(contract_id)
            });
            if duplicate {
                return false;
            }
            history.push(history_entry);
            return true;
        }
    }
    false
}

fn fnv1a_64(input: &[u8]) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let mut hash = OFFSET_BASIS;
    for byte in input {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_email_extraction_matches_clause_keywords() {
        let playbook = vec![json!({
            "clause_id": "C01",
            "name": "Liability",
            "keywords": ["liability"]
        })];

        let extracted = extract_email_outcome_locally(
            "Customer: MegaCorp\nJurisdiction: Germany\nWe need fallback liability language.",
            &playbook,
        );

        assert_eq!(
            extracted["counterparty"],
            Value::String("MegaCorp".to_string())
        );
        assert_eq!(
            extracted["clauses"][0]["clause_id"],
            Value::String("C01".to_string())
        );
        assert_eq!(
            extracted["clauses"][0]["outcome"],
            Value::String("fallback_1".to_string())
        );
        assert_eq!(
            extracted["clauses"][0]["confidence"],
            Value::String("medium".to_string())
        );
        assert!(
            extracted["clauses"][0]["evidence"]
                .as_str()
                .unwrap_or("")
                .contains("fallback liability")
        );
        assert!(
            extracted["clauses"][0]["rationale"]
                .as_str()
                .unwrap_or("")
                .contains("fallback 1")
        );
    }

    #[test]
    fn low_confidence_when_extracted_clause_fields_empty() {
        let extracted = json!({
            "counterparty": "MegaCorp",
            "clauses": [{ "clause_id": "", "outcome": "preferred", "escalated": false }]
        });

        assert!(extraction_low_confidence(&extracted));
    }

    #[test]
    fn normalize_email_extraction_backfills_review_fields() {
        let extracted = normalize_email_extraction(
            json!({
                "counterparty": "",
                "clauses": [{ "clause_id": "C01", "outcome": "fallback_1" }]
            }),
            "Customer: MegaCorp\nJurisdiction: Germany\nLiability accepted as fallback.",
        );

        assert_eq!(
            extracted["counterparty"],
            Value::String("MegaCorp".to_string())
        );
        assert_eq!(
            extracted["clauses"][0]["confidence"],
            Value::String("low".to_string())
        );
        assert_eq!(
            extracted["clauses"][0]["jurisdiction"],
            Value::String("Germany".to_string())
        );
        assert!(extracted["clauses"][0]["rationale"].as_str().is_some());
    }

    #[test]
    fn append_negotiation_history_once_skips_duplicate_email_insight() {
        let mut clause = json!({
            "clause_id": "C01",
            "negotiation_history": []
        });
        let history_entry = json!({
            "contract_id": "EM-123",
            "email_queue_id": "EM-123",
            "source": "email_agent",
            "outcome": "fallback_1"
        });

        assert!(append_negotiation_history_once(
            &mut clause,
            history_entry.clone()
        ));
        assert!(!append_negotiation_history_once(&mut clause, history_entry));
        assert_eq!(
            clause["negotiation_history"].as_array().map(Vec::len),
            Some(1)
        );
    }
}
