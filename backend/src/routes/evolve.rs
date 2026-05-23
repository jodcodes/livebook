use axum::{Json, extract::Path, http::StatusCode};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::collections::HashSet;
use tracing::instrument;
use utoipa::ToSchema;

use crate::repositories::store;

#[utoipa::path(
    get,
    path = "/evolve",
    responses(
        (status = 200, description = "Pending evolve suggestions.", body = Vec<Value>),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Evolve"
)]
#[instrument]
pub async fn get_evolve() -> Result<Json<Value>, (StatusCode, String)> {
    run_evolve_analysis().await?;
    let suggestions = read_suggestions().await?;
    let pending: Vec<Value> = suggestions
        .into_iter()
        .filter(|entry| entry.get("status").and_then(Value::as_str) == Some("pending"))
        .collect();
    Ok(Json(Value::Array(pending)))
}

#[utoipa::path(
    post,
    path = "/evolve/{id}/approve",
    params(("id" = String, Path, description = "Suggestion ID")),
    request_body = EvolveApproveRequest,
    responses(
        (status = 200, description = "Suggestion approved and applied.", body = Value),
        (status = 404, description = "Suggestion or clause not found."),
        (status = 409, description = "Clause version changed since suggestion generation."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Evolve"
)]
#[instrument]
pub async fn approve_evolve(
    Path(id): Path<String>,
    body: Option<Json<EvolveApproveRequest>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut suggestions = read_suggestions().await?;
    let suggestion_idx = suggestions
        .iter()
        .position(|entry| entry.get("id").and_then(Value::as_str) == Some(id.as_str()))
        .ok_or((StatusCode::NOT_FOUND, "suggestion not found".to_string()))?;
    let suggestion = suggestions[suggestion_idx].clone();
    let clause_id = suggestion
        .get("clause_id")
        .and_then(Value::as_str)
        .ok_or((
            StatusCode::NOT_FOUND,
            "suggestion has no clause_id".to_string(),
        ))?
        .to_string();
    let expected_version = suggestion
        .get("clause_version_at_generation")
        .and_then(Value::as_u64)
        .unwrap_or(1);

    let mut clauses = read_playbook_array().await?;
    let clause_idx = find_clause_index(&clauses, &clause_id)?;
    let actual_version = meta_version(&clauses[clause_idx]);
    if actual_version != expected_version {
        return Err((
            StatusCode::CONFLICT,
            "clause was modified since suggestion generation".to_string(),
        ));
    }

    append_history(&mut clauses[clause_idx], "lawyer", "edit");
    let proposed_change = body
        .and_then(|Json(body)| body.proposed_change)
        .or_else(|| suggestion.get("proposed_change").cloned());
    if let Some(proposed_change) = proposed_change {
        deep_merge(&mut clauses[clause_idx], &proposed_change);
    }
    increment_meta_version(&mut clauses[clause_idx]);
    set_meta_bool(&mut clauses[clause_idx], "pending_evolve", false);
    normalize_clause(&mut clauses[clause_idx]);
    suggestions[suggestion_idx]["status"] = Value::String("approved".to_string());
    suggestions[suggestion_idx]["archived_at"] = Value::String(Utc::now().to_rfc3339());

    write_playbook_array(&clauses).await?;
    write_suggestions(&suggestions).await?;
    Ok(Json(clauses[clause_idx].clone()))
}

#[utoipa::path(
    post,
    path = "/evolve/{id}/reject",
    params(("id" = String, Path, description = "Suggestion ID")),
    responses(
        (status = 200, description = "Suggestion rejected and archived.", body = Value),
        (status = 404, description = "Suggestion not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Evolve"
)]
#[instrument]
pub async fn reject_evolve(Path(id): Path<String>) -> Result<Json<Value>, (StatusCode, String)> {
    let mut suggestions = read_suggestions().await?;
    let suggestion_idx = suggestions
        .iter()
        .position(|entry| entry.get("id").and_then(Value::as_str) == Some(id.as_str()))
        .ok_or((StatusCode::NOT_FOUND, "suggestion not found".to_string()))?;
    let clause_id = suggestions[suggestion_idx]
        .get("clause_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    suggestions[suggestion_idx]["status"] = Value::String("rejected".to_string());
    suggestions[suggestion_idx]["archived_at"] = Value::String(Utc::now().to_rfc3339());
    write_suggestions(&suggestions).await?;

    let mut clauses = read_playbook_array().await?;
    if let Ok(clause_idx) = find_clause_index(&clauses, &clause_id) {
        set_meta_bool(&mut clauses[clause_idx], "pending_evolve", false);
        write_playbook_array(&clauses).await?;
    }
    Ok(Json(suggestions[suggestion_idx].clone()))
}

pub async fn restore_evolve(Path(id): Path<String>) -> Result<Json<Value>, (StatusCode, String)> {
    let mut suggestions = read_suggestions().await?;
    let suggestion_idx = suggestions
        .iter()
        .position(|entry| entry.get("id").and_then(Value::as_str) == Some(id.as_str()))
        .ok_or((StatusCode::NOT_FOUND, "suggestion not found".to_string()))?;
    let clause_id = suggestions[suggestion_idx]
        .get("clause_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    restore_suggestion_pending(&mut suggestions[suggestion_idx]);
    write_suggestions(&suggestions).await?;

    let mut clauses = read_playbook_array().await?;
    if let Ok(clause_idx) = find_clause_index(&clauses, &clause_id) {
        set_meta_bool(&mut clauses[clause_idx], "pending_evolve", true);
        write_playbook_array(&clauses).await?;
    }
    Ok(Json(suggestions[suggestion_idx].clone()))
}

pub async fn run_evolve_analysis() -> Result<(), (StatusCode, String)> {
    let mut clauses = read_playbook_array().await?;
    let mut suggestions = read_suggestions().await?;
    let rejected: HashSet<String> = suggestions
        .iter()
        .filter(|entry| entry.get("status").and_then(Value::as_str) == Some("rejected"))
        .filter_map(|entry| {
            entry
                .get("pattern_fingerprint")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect();
    let approved: HashSet<String> = suggestions
        .iter()
        .filter(|entry| entry.get("status").and_then(Value::as_str) == Some("approved"))
        .filter_map(|entry| {
            entry
                .get("pattern_fingerprint")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect();
    let pending: HashSet<String> = suggestions
        .iter()
        .filter(|entry| entry.get("status").and_then(Value::as_str) == Some("pending"))
        .filter_map(|entry| {
            entry
                .get("pattern_fingerprint")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect();

    let mut changed_playbook = false;
    for clause in &mut clauses {
        let Some(clause_id) = clause.get("clause_id").and_then(Value::as_str) else {
            continue;
        };
        let histories = clause
            .get("negotiation_history")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let deviations: Vec<Value> = histories
            .into_iter()
            .filter(|entry| {
                entry
                    .get("outcome")
                    .and_then(Value::as_str)
                    .is_some_and(|outcome| !outcome.is_empty() && outcome != "preferred")
            })
            .collect();
        if deviations.is_empty() {
            continue;
        }

        let outcome = deviations[0]
            .get("outcome")
            .and_then(Value::as_str)
            .unwrap_or("fallback_1");
        let contracts: Vec<String> = deviations
            .iter()
            .filter_map(|entry| {
                entry
                    .get("contract_id")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .collect();
        let fingerprint = format!("{clause_id}:{outcome}:{}", contracts.join(","));
        if rejected.contains(&fingerprint)
            || approved.contains(&fingerprint)
            || pending.contains(&fingerprint)
        {
            continue;
        }
        let confidence = match contracts.len() {
            0 | 1 => "low",
            2 | 3 => "medium",
            _ => "high",
        };
        let proposed_position = clause
            .get("positions")
            .and_then(|positions| positions.get(outcome))
            .and_then(Value::as_str)
            .unwrap_or(outcome);
        let suggestion = json!({
            "id": format!("EV-{:016x}", fnv1a_64(fingerprint.as_bytes())),
            "clause_id": clause_id,
            "clause_version_at_generation": meta_version(clause),
            "pattern_description": format!("Negotiations repeatedly settled at {outcome} instead of preferred."),
            "supporting_contracts": contracts,
            "proposed_change": { "positions": { "preferred": proposed_position } },
            "confidence": confidence,
            "status": "pending",
            "pattern_fingerprint": fingerprint,
            "created_at": Utc::now().to_rfc3339()
        });
        suggestions.push(suggestion);
        set_meta_bool(clause, "pending_evolve", true);
        changed_playbook = true;
    }

    // Keep clause meta.pending_evolve in sync with actual pending suggestions.
    let pending_clause_ids: HashSet<String> = suggestions
        .iter()
        .filter(|entry| entry.get("status").and_then(Value::as_str) == Some("pending"))
        .filter_map(|entry| {
            entry
                .get("clause_id")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect();
    for clause in &mut clauses {
        let Some(clause_id) = clause.get("clause_id").and_then(Value::as_str) else {
            continue;
        };
        let should_be_pending = pending_clause_ids.contains(clause_id);
        let currently_pending = clause
            .get("meta")
            .and_then(|meta| meta.get("pending_evolve"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if currently_pending != should_be_pending {
            set_meta_bool(clause, "pending_evolve", should_be_pending);
            changed_playbook = true;
        }
    }

    write_suggestions(&suggestions).await?;
    if changed_playbook {
        write_playbook_array(&clauses).await?;
    }
    Ok(())
}

async fn read_suggestions() -> Result<Vec<Value>, (StatusCode, String)> {
    store::list_evolve_suggestions()
        .await
        .map_err(internal_error)
}

async fn write_suggestions(suggestions: &[Value]) -> Result<(), (StatusCode, String)> {
    for suggestion in suggestions {
        let id = suggestion.get("id").and_then(Value::as_str).ok_or((
            StatusCode::INTERNAL_SERVER_ERROR,
            "evolve suggestion is missing id".to_string(),
        ))?;
        let clause_id = suggestion.get("clause_id").and_then(Value::as_str);
        let status = suggestion
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("pending");
        store::upsert_evolve_suggestion(id, clause_id, status, suggestion)
            .await
            .map_err(internal_error)?;
    }
    Ok(())
}

async fn read_playbook_array() -> Result<Vec<Value>, (StatusCode, String)> {
    let mut value = store::get_document("playbook/current")
        .await
        .map_err(internal_error)?
        .unwrap_or(Value::Null);
    match &mut value {
        Value::Array(clauses) => {
            for clause in clauses {
                normalize_clause(clause);
            }
            Ok(value.as_array().cloned().unwrap_or_default())
        }
        Value::Object(_) => {
            normalize_clause(&mut value);
            Ok(vec![value])
        }
        _ => Ok(Vec::new()),
    }
}

async fn write_playbook_array(clauses: &[Value]) -> Result<(), (StatusCode, String)> {
    store::replace_playbook_documents(&Value::Array(clauses.to_vec()), "evolve_update", None, None)
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
        .ok_or((StatusCode::NOT_FOUND, "clause not found".to_string()))
}

fn deep_merge(target: &mut Value, patch: &Value) {
    match (target, patch) {
        (Value::Object(target_object), Value::Object(patch_object)) => {
            for (key, value) in patch_object {
                match (target_object.get_mut(key), value) {
                    (Some(existing @ Value::Object(_)), Value::Object(_)) => {
                        deep_merge(existing, value)
                    }
                    _ => {
                        target_object.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (target, patch) => *target = patch.clone(),
    }
}

fn normalize_clause(clause: &mut Value) {
    let fallback_version_id = stable_version_id(clause);
    if let Some(object) = clause.as_object_mut() {
        let meta = object
            .entry("meta".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(meta_object) = meta.as_object_mut() {
            meta_object
                .entry("version".to_string())
                .or_insert(Value::Number(1.into()));
            meta_object
                .entry("review_status".to_string())
                .or_insert(Value::String("pending".to_string()));
            meta_object
                .entry("pending_evolve".to_string())
                .or_insert(Value::Bool(false));
            meta_object
                .entry("version_id".to_string())
                .or_insert(Value::String(fallback_version_id));
        }
        object
            .entry("history".to_string())
            .or_insert_with(|| Value::Array(Vec::new()));
    }
}

fn append_history(clause: &mut Value, approved_by: &str, action: &str) {
    let version = meta_version(clause);
    let version_id = ensure_version_id(clause);
    let previous_version_id = meta_string(clause, "previous_version_id");
    let mut snapshot = clause.clone();
    if let Some(object) = snapshot.as_object_mut() {
        object.remove("history");
    }
    let mut entry = json!({
        "version": version,
        "version_id": version_id,
        "fields_snapshot": snapshot,
        "approved_by": approved_by,
        "timestamp": Utc::now().to_rfc3339(),
        "action": action
    });
    if let Some(previous_version_id) = previous_version_id {
        entry["previous_version_id"] = Value::String(previous_version_id);
    }
    if let Some(object) = clause.as_object_mut() {
        object
            .entry("history".to_string())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(history) = object.get_mut("history").and_then(Value::as_array_mut) {
            history.push(entry);
        }
    }
}

fn increment_meta_version(clause: &mut Value) {
    let previous = ensure_version_id(clause);
    let next = meta_version(clause) + 1;
    let clause_id = clause
        .get("clause_id")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    if let Some(meta) = clause.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("version".to_string(), Value::Number(next.into()));
        meta.insert("previous_version_id".to_string(), Value::String(previous));
        meta.insert(
            "version_id".to_string(),
            Value::String(generate_version_id(&clause_id, next, "evolve")),
        );
    }
}

fn set_meta_bool(clause: &mut Value, key: &str, value: bool) {
    if let Some(object) = clause.as_object_mut() {
        let meta = object
            .entry("meta".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(meta_object) = meta.as_object_mut() {
            meta_object.insert(key.to_string(), Value::Bool(value));
        }
    }
}

fn restore_suggestion_pending(suggestion: &mut Value) {
    if let Some(object) = suggestion.as_object_mut() {
        object.insert("status".to_string(), Value::String("pending".to_string()));
        object.remove("archived_at");
    }
}

fn meta_version(clause: &Value) -> u64 {
    clause
        .get("meta")
        .and_then(|meta| meta.get("version"))
        .and_then(Value::as_u64)
        .unwrap_or(1)
}

fn meta_string(clause: &Value, key: &str) -> Option<String> {
    clause
        .get("meta")
        .and_then(|meta| meta.get(key))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
}

fn stable_version_id(clause: &Value) -> String {
    let seed = json!({
        "clause_id": clause.get("clause_id"),
        "version": meta_version(clause),
        "name": clause.get("name"),
        "positions": clause.get("positions"),
        "red_line": clause.get("red_line"),
        "escalation_trigger": clause.get("escalation_trigger"),
    });
    format!("VER-{:016x}", fnv1a_64(seed.to_string().as_bytes()))
}

fn generate_version_id(clause_id: &str, version: u64, action: &str) -> String {
    let now = Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_else(|| Utc::now().timestamp_micros() * 1_000);
    let seed = format!("{clause_id}:{version}:{action}:{now}");
    format!("VER-{:016x}", fnv1a_64(seed.as_bytes()))
}

fn ensure_version_id(clause: &mut Value) -> String {
    if let Some(existing) = meta_string(clause, "version_id") {
        return existing;
    }
    let version_id = stable_version_id(clause);
    if let Some(object) = clause.as_object_mut() {
        let meta = object
            .entry("meta".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(meta_object) = meta.as_object_mut() {
            meta_object.insert("version_id".to_string(), Value::String(version_id.clone()));
        }
    }
    version_id
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
#[derive(Debug, Deserialize, ToSchema)]
pub struct EvolveApproveRequest {
    pub proposed_change: Option<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_suggestion_reopens_archived_item() {
        let mut suggestion = json!({
            "id": "EV-1",
            "clause_id": "C01",
            "status": "approved",
            "archived_at": "2026-04-25T12:00:00Z"
        });

        restore_suggestion_pending(&mut suggestion);

        assert_eq!(suggestion["status"], Value::String("pending".to_string()));
        assert!(suggestion.get("archived_at").is_none());
    }
}
