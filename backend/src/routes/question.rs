use axum::{Json, extract::Query, http::StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use tracing::{info, instrument, warn};
use utoipa::ToSchema;

use crate::repositories::store;
use crate::routes::chat_queries::{ChatQueryActor, CreateChatQuery, record_chat_query};
use crate::routes::playbook::{compare_versions, extract_version_ids_from_text};
use crate::services::retrieval;

#[derive(Deserialize)]
pub struct QuestionParams {
    pub q: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, ToSchema)]
pub struct ChatTurn {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize, Serialize, ToSchema)]
pub struct QuestionRequest {
    pub q: String,
    pub history: Option<Vec<ChatTurn>>,
    pub session_id: Option<String>,
    pub created_by: Option<ChatQueryActor>,
}

#[derive(Deserialize, Serialize, ToSchema)]
pub struct QuestionAnswer {
    pub answer: String,
    pub clause_ref: String,
    pub position_used: String,
    pub escalation_required: bool,
    pub next_action: String,
    pub query_id: Option<String>,
}

#[utoipa::path(
    get,
    path = "/question",
    params(("q" = Option<String>, Query, description = "User question to be answered using the playbook")),
    responses(
        (status = 200, description = "Structured answer generated from playbook context.", body = QuestionAnswer),
        (status = 400, description = "Missing or empty query parameter."),
        (status = 409, description = "No approved playbook clauses are available."),
        (status = 500, description = "Server-side processing failure."),
        (status = 502, description = "OpenAI upstream call failed.")
    ),
    tag = "Question"
)]
#[instrument(skip(params), fields(question_len = params.q.as_deref().unwrap_or("").len()))]
pub async fn get_question(
    Query(params): Query<QuestionParams>,
) -> Result<(StatusCode, Json<QuestionAnswer>), (StatusCode, String)> {
    let q = params.q.unwrap_or_default();
    answer_question(QuestionRequest {
        q,
        history: None,
        session_id: None,
        created_by: None,
    })
    .await
}

#[utoipa::path(
    post,
    path = "/question",
    request_body = QuestionRequest,
    responses(
        (status = 200, description = "Structured answer generated from playbook context.", body = QuestionAnswer),
        (status = 400, description = "Missing or empty question."),
        (status = 409, description = "No approved playbook clauses are available."),
        (status = 500, description = "Server-side processing failure."),
        (status = 502, description = "OpenAI upstream call failed.")
    ),
    tag = "Question"
)]
#[instrument(skip(body), fields(question_len = body.q.len()))]
pub async fn post_question(
    Json(body): Json<QuestionRequest>,
) -> Result<(StatusCode, Json<QuestionAnswer>), (StatusCode, String)> {
    answer_question(body).await
}

async fn answer_question(
    body: QuestionRequest,
) -> Result<(StatusCode, Json<QuestionAnswer>), (StatusCode, String)> {
    if body.q.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "question `q` must not be empty".to_string(),
        ));
    }

    if let Some(mut answer) = answer_version_compare_question(&body.q).await? {
        persist_chat_query(&body, &mut answer).await?;
        return Ok((StatusCode::OK, Json(answer)));
    }

    let playbook = load_approved_playbook_context().await?;
    let history_turns = body.history.clone().unwrap_or_default();

    if let Some(mut answer) = clarification_answer(&body.q, &history_turns, &playbook) {
        persist_chat_query(&body, &mut answer).await?;
        return Ok((StatusCode::OK, Json(answer)));
    }

    let config = store::config().map_err(internal_error)?;
    let api_key = config.openai_api_key.clone().ok_or((
        StatusCode::INTERNAL_SERVER_ERROR,
        "OPENAI_API_KEY is not configured".to_string(),
    ))?;
    let retrieved_clauses = retrieval::retrieve_relevant_clauses(&body.q, &history_turns).await?;
    if retrieved_clauses.is_empty() {
        return Err((
            StatusCode::CONFLICT,
            "no approved playbook clauses are available for question answering".to_string(),
        ));
    }

    let evidence = serde_json::to_string_pretty(&retrieved_clauses).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to serialize retrieval evidence: {err}"),
        )
    })?;

    let history = history_turns
        .into_iter()
        .rev()
        .take(10)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|turn| format!("{}: {}", turn.role, turn.content))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "You answer business contract questions from the approved playbook clauses only.\n\
         Return only JSON with this exact shape:\n\
         {{\"answer\":\"plain-language answer ending with an action statement\",\"clause_ref\":\"clause ID and name or Clarification required\",\"position_used\":\"preferred|fallback_1|fallback_2|clarification\",\"escalation_required\":false,\"next_action\":\"one-sentence instruction\"}}\n\
         Rules:\n\
         - Use only clauses included under RETRIEVED EVIDENCE. Do not infer from missing, pending, rejected, or unapproved clauses.\n\
         - Use prior history when it changes what the follow-up question means.\n\
         - If the relevant playbook, opposite party, or legal area is unclear, ask a short clarifying question instead of guessing. Use clause_ref `Clarification required` and position_used `clarification`.\n\
         - If escalation is required, set escalation_required true and start answer with `⚠ ESCALATION REQUIRED:`.\n\
         - No markdown fences and no text outside the JSON object.\n\n\
         RECENT HISTORY:\n{history}\n\n\
         RETRIEVED EVIDENCE:\n{evidence}\n\n\
         QUESTION:\n{}",
        body.q
    );

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&json!({
            "model": config.openai_model,
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
        warn!(status = %status, "OpenAI API returned an error");
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

    let answer = extract_output_text(&value).unwrap_or_default();
    if answer.trim().is_empty() {
        return Err((
            StatusCode::BAD_GATEWAY,
            "OpenAI response did not contain text output".to_string(),
        ));
    }

    let cleaned_answer = strip_code_fences(answer.trim());
    let mut structured: QuestionAnswer = serde_json::from_str(cleaned_answer).map_err(|err| {
        (
            StatusCode::BAD_GATEWAY,
            format!("OpenAI output was not valid answer JSON: {err}"),
        )
    })?;

    let playbook_value = Value::Array(retrieved_clauses);
    enforce_escalation_override(&mut structured, &playbook_value, &body.q);
    persist_chat_query(&body, &mut structured).await?;

    info!("question answered");
    Ok((StatusCode::OK, Json(structured)))
}

async fn persist_chat_query(
    body: &QuestionRequest,
    answer: &mut QuestionAnswer,
) -> Result<(), (StatusCode, String)> {
    let item = record_chat_query(CreateChatQuery {
        session_id: body.session_id.clone(),
        created_by: body.created_by.clone(),
        question: body.q.clone(),
        answer: answer.answer.clone(),
        clause_ref: answer.clause_ref.clone(),
        position_used: answer.position_used.clone(),
        escalation_required: answer.escalation_required,
        next_action: answer.next_action.clone(),
    })
    .await?;
    answer.query_id = Some(item.id);
    Ok(())
}

async fn answer_version_compare_question(
    question: &str,
) -> Result<Option<QuestionAnswer>, (StatusCode, String)> {
    let ids = extract_version_ids_from_text(question);
    if ids.len() != 2 {
        return Ok(None);
    }

    let comparison = compare_versions(&ids[0], &ids[1], "business", Some(question)).await?;
    Ok(Some(QuestionAnswer {
        answer: comparison.explanation,
        clause_ref: format!("{} {}", comparison.clause_id, comparison.clause_name),
        position_used: "version_compare".to_string(),
        escalation_required: false,
        next_action: "Open Version History for the detailed diff before relying on the change."
            .to_string(),
        query_id: None,
    }))
}

async fn load_approved_playbook_context() -> Result<Value, (StatusCode, String)> {
    let playbook = store::get_document("playbook/current")
        .await
        .map_err(internal_error)?
        .unwrap_or(Value::Null);

    let approved = approved_clauses(&playbook);
    if approved.is_empty() {
        return Err((
            StatusCode::CONFLICT,
            "no approved playbook clauses are available for question answering".to_string(),
        ));
    }

    Ok(Value::Array(approved))
}

fn internal_error(message: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, message)
}

fn approved_clauses(playbook: &Value) -> Vec<Value> {
    playbook
        .as_array()
        .map(|clauses| {
            clauses
                .iter()
                .filter(|clause| is_clause_approved(clause))
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

fn is_clause_approved(clause: &Value) -> bool {
    clause
        .get("meta")
        .and_then(|meta| meta.get("review_status"))
        .and_then(Value::as_str)
        == Some("approved")
}

fn clarification_answer(
    question: &str,
    history: &[ChatTurn],
    playbook: &Value,
) -> Option<QuestionAnswer> {
    let clauses = playbook.as_array()?;
    if clauses.len() <= 1 {
        return None;
    }

    let scope_text = scope_text(question, history);
    let scored_clauses = clauses
        .iter()
        .filter(|clause| clause_scope_score(clause, &scope_text) > 0)
        .collect::<Vec<_>>();
    let candidate_clauses = if scored_clauses.is_empty() {
        clauses.iter().collect::<Vec<_>>()
    } else {
        scored_clauses
    };

    let needs = [
        missing_scope(
            "which playbook",
            "playbook",
            &candidate_clauses,
            &scope_text,
            &["playbook_id", "playbook_name"],
        ),
        missing_scope(
            "which opposite party",
            "opposite party",
            &candidate_clauses,
            &scope_text,
            &["party_name"],
        ),
        missing_scope(
            "which legal area",
            "legal area",
            &candidate_clauses,
            &scope_text,
            &["law_type", "clause_type"],
        ),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();

    if needs.is_empty() {
        return None;
    }

    let answer = format!(
        "I need one bit more context before I can answer from the approved playbook. Please clarify {}.",
        needs
            .iter()
            .map(|need| need.prompt.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );
    let next_action = format!(
        "Reply with {} so I can use the right approved clause.",
        needs
            .iter()
            .map(|need| need.label.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );

    Some(QuestionAnswer {
        answer,
        clause_ref: "Clarification required".to_string(),
        position_used: "clarification".to_string(),
        escalation_required: false,
        next_action,
        query_id: None,
    })
}

struct MissingScope {
    label: String,
    prompt: String,
}

fn missing_scope(
    question_label: &str,
    answer_label: &str,
    clauses: &[&Value],
    scope_text: &str,
    fields: &[&str],
) -> Option<MissingScope> {
    let options = scope_options(clauses, fields);
    if options.len() <= 1
        || options
            .iter()
            .any(|option| scope_mentions_option(scope_text, option))
    {
        return None;
    }

    let preview = options
        .iter()
        .take(4)
        .map(|option| display_scope_option(option))
        .collect::<Vec<_>>()
        .join(", ");
    let suffix = if options.len() > 4 { ", ..." } else { "" };

    Some(MissingScope {
        label: answer_label.to_string(),
        prompt: format!("{question_label} ({preview}{suffix})"),
    })
}

fn scope_options(clauses: &[&Value], fields: &[&str]) -> Vec<String> {
    clauses
        .iter()
        .filter_map(|clause| {
            fields.iter().find_map(|field| {
                clause
                    .get(*field)
                    .and_then(Value::as_str)
                    .map(normalize_scope_value)
            })
        })
        .filter(|value| !value.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn scope_text(question: &str, history: &[ChatTurn]) -> String {
    normalize_scope_value(
        &history
            .iter()
            .rev()
            .take(10)
            .rev()
            .map(|turn| turn.content.as_str())
            .chain(std::iter::once(question))
            .collect::<Vec<_>>()
            .join(" "),
    )
}

fn clause_scope_score(clause: &Value, scope_text: &str) -> usize {
    let direct_fields = [
        "clause_id",
        "original_clause_id",
        "name",
        "clause_type",
        "law_type",
        "playbook_id",
        "playbook_name",
        "party_name",
    ];
    let direct_score = direct_fields
        .iter()
        .filter_map(|field| clause.get(*field).and_then(Value::as_str))
        .map(normalize_scope_value)
        .filter(|value| !value.is_empty() && scope_mentions_option(scope_text, value))
        .count();

    let keyword_score = clause
        .get("keywords")
        .and_then(Value::as_array)
        .map(|keywords| {
            keywords
                .iter()
                .filter_map(Value::as_str)
                .filter(|keyword| keyword_matches_scope(keyword, scope_text))
                .count()
        })
        .unwrap_or(0);

    direct_score + keyword_score
}

fn keyword_matches_scope(keyword: &str, scope_text: &str) -> bool {
    let normalized = normalize_scope_value(keyword);
    if normalized.is_empty() {
        return false;
    }
    if scope_text.contains(&normalized) {
        return true;
    }
    normalized
        .split_whitespace()
        .any(|word| word.len() >= 5 && scope_text.contains(word))
}

fn scope_mentions_option(scope_text: &str, option: &str) -> bool {
    scope_text.contains(option)
        || option
            .split_whitespace()
            .any(|word| is_specific_scope_word(word) && scope_text.contains(word))
}

fn is_specific_scope_word(word: &str) -> bool {
    word.len() >= 4
        && !matches!(
            word,
            "agreement"
                | "area"
                | "clause"
                | "contract"
                | "legal"
                | "playbook"
                | "position"
                | "terms"
        )
}

fn normalize_scope_value(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn display_scope_option(option: &str) -> String {
    option
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            chars
                .next()
                .map(|first| first.to_ascii_uppercase().to_string() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn enforce_escalation_override(answer: &mut QuestionAnswer, playbook: &Value, question: &str) {
    let matched = find_matched_clause(playbook, &answer.clause_ref);
    let Some(clause) = matched else {
        return;
    };
    let always_escalate = clause
        .get("always_escalate")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let trigger = clause
        .get("escalation_trigger")
        .and_then(Value::as_str)
        .unwrap_or("");
    let trigger_match = !trigger.is_empty()
        && question
            .to_ascii_lowercase()
            .contains(&trigger.to_ascii_lowercase());
    if always_escalate || trigger_match {
        answer.escalation_required = true;
        if !answer.answer.starts_with("⚠ ESCALATION REQUIRED:") {
            answer.answer = format!(
                "⚠ ESCALATION REQUIRED: Legal Counsel must review before you proceed.\n\n{}",
                answer.answer
            );
        }
        if answer.next_action.trim().is_empty() {
            answer.next_action = "Escalate this to Legal Counsel before responding.".to_string();
        }
    }
}

fn find_matched_clause<'a>(playbook: &'a Value, clause_ref: &str) -> Option<&'a Value> {
    let clauses = playbook.as_array()?;
    let lower_ref = clause_ref.to_ascii_lowercase();
    clauses.iter().find(|clause| {
        clause
            .get("clause_id")
            .and_then(Value::as_str)
            .is_some_and(|id| lower_ref.contains(&id.to_ascii_lowercase()))
            || clause
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| lower_ref.contains(&name.to_ascii_lowercase()))
    })
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

fn strip_code_fences(raw: &str) -> &str {
    if let Some(stripped) = raw
        .strip_prefix("```json")
        .and_then(|s| s.strip_suffix("```"))
    {
        return stripped.trim();
    }
    if let Some(stripped) = raw.strip_prefix("```").and_then(|s| s.strip_suffix("```")) {
        return stripped.trim();
    }
    raw
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escalation_override_prefixes_answer_for_always_escalate_clause() {
        let playbook = json!([{
            "clause_id": "C01",
            "name": "Liability",
            "meta": { "review_status": "approved" },
            "always_escalate": true,
            "escalation_trigger": "uncapped"
        }]);
        let mut answer = QuestionAnswer {
            answer: "Use fallback.".to_string(),
            clause_ref: "C01 Liability".to_string(),
            position_used: "fallback_1".to_string(),
            escalation_required: false,
            next_action: "Ask Legal.".to_string(),
            query_id: None,
        };

        enforce_escalation_override(&mut answer, &playbook, "Can we accept this?");

        assert!(answer.escalation_required);
        assert!(answer.answer.starts_with("⚠ ESCALATION REQUIRED:"));
    }

    #[test]
    fn approved_clauses_filters_out_pending_clauses() {
        let playbook = json!([
            {
                "clause_id": "C01",
                "name": "Approved",
                "meta": { "review_status": "approved" }
            },
            {
                "clause_id": "C02",
                "name": "Pending",
                "meta": { "review_status": "pending" }
            },
            {
                "clause_id": "C03",
                "name": "Missing Status"
            }
        ]);

        let approved = approved_clauses(&playbook);

        assert_eq!(approved.len(), 1);
        assert_eq!(approved[0]["clause_id"], Value::String("C01".to_string()));
    }

    #[test]
    fn clarification_answer_asks_when_scope_is_ambiguous() {
        let playbook = json!([
            {
                "clause_id": "globex:NDA-01",
                "name": "Liability",
                "clause_type": "Liability",
                "law_type": "General Commercial",
                "playbook_id": "globex",
                "playbook_name": "Globex NDA",
                "party_name": "Globex GmbH",
                "keywords": ["liability cap"],
                "meta": { "review_status": "approved" }
            },
            {
                "clause_id": "initech:SLA-01",
                "name": "Service Levels",
                "clause_type": "Service Levels",
                "law_type": "Digital Industries / Automation",
                "playbook_id": "initech",
                "playbook_name": "Initech SaaS",
                "party_name": "Initech Ltd",
                "keywords": ["uptime"],
                "meta": { "review_status": "approved" }
            }
        ]);

        let answer = clarification_answer("What are our terms?", &[], &playbook).unwrap();

        assert_eq!(answer.clause_ref, "Clarification required");
        assert_eq!(answer.position_used, "clarification");
        assert!(answer.answer.contains("which playbook"));
        assert!(answer.answer.contains("which opposite party"));
        assert!(answer.answer.contains("which legal area"));
    }

    #[test]
    fn clarification_answer_allows_clear_clause_keyword() {
        let playbook = json!([
            {
                "clause_id": "globex:NDA-01",
                "name": "Liability",
                "clause_type": "Liability",
                "law_type": "General Commercial",
                "playbook_id": "globex",
                "playbook_name": "Globex NDA",
                "party_name": "Globex GmbH",
                "keywords": ["liability cap"],
                "meta": { "review_status": "approved" }
            },
            {
                "clause_id": "initech:SLA-01",
                "name": "Service Levels",
                "clause_type": "Service Levels",
                "law_type": "Digital Industries / Automation",
                "playbook_id": "initech",
                "playbook_name": "Initech SaaS",
                "party_name": "Initech Ltd",
                "keywords": ["uptime"],
                "meta": { "review_status": "approved" }
            }
        ]);

        let answer = clarification_answer("What is the liability cap?", &[], &playbook);

        assert!(answer.is_none());
    }

    #[test]
    fn escalation_override_ignores_clauses_excluded_from_approved_context() {
        let full_playbook = json!([
            {
                "clause_id": "C01",
                "name": "Approved",
                "meta": { "review_status": "approved" },
                "always_escalate": false,
                "escalation_trigger": ""
            },
            {
                "clause_id": "C02",
                "name": "Pending Liability",
                "meta": { "review_status": "pending" },
                "always_escalate": true,
                "escalation_trigger": "uncapped"
            }
        ]);
        let approved_context = Value::Array(approved_clauses(&full_playbook));
        let mut answer = QuestionAnswer {
            answer: "I cannot rely on pending clauses.".to_string(),
            clause_ref: "C02 Pending Liability".to_string(),
            position_used: "preferred".to_string(),
            escalation_required: false,
            next_action: "Ask Legal to approve the clause first.".to_string(),
            query_id: None,
        };

        enforce_escalation_override(
            &mut answer,
            &approved_context,
            "Can we accept uncapped liability?",
        );

        assert!(!answer.escalation_required);
        assert!(!answer.answer.starts_with("⚠ ESCALATION REQUIRED:"));
    }
}
