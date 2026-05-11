use axum::{
    Json,
    extract::{Multipart, Path},
    http::StatusCode,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};
use tokio::{fs, process::Command};
use tracing::{instrument, warn};
use utoipa::ToSchema;

use crate::repositories::store;
use crate::routes::escalation::{
    CreateEscalationRequest, EscalationActor, EscalationLawyer, EscalationSource, queue_escalation,
};
use crate::routes::evolve::run_evolve_analysis;

const DEFAULT_OPENAI_TABULAR_MODEL: &str = "gpt-5.5";
const MAX_CONTRACT_PROMPT_CHARS: usize = 18_000;
const OPENAI_TABULAR_TIMEOUT_SECS: u64 = 8;

fn default_uploaded_by_role() -> String {
    "lawyer".to_string()
}

#[derive(Debug, Clone, Copy)]
enum ContractFileKind {
    Pdf,
    Docx,
}

impl ContractFileKind {
    fn extension(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Docx => "docx",
        }
    }
}

struct UploadedContractFile {
    bytes: Vec<u8>,
    file_name: String,
    kind: ContractFileKind,
}

#[derive(Debug, Clone)]
struct ReviewUploader {
    role: String,
    display_name: String,
    email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct TabularReviewSession {
    pub session_id: String,
    pub created_at: String,
    pub status: String,
    #[serde(default = "default_uploaded_by_role")]
    pub uploaded_by_role: String,
    #[serde(default)]
    pub escalation_id: Option<String>,
    pub playbook_hash: String,
    pub playbook_clause_count: usize,
    pub contracts: Vec<TabularReviewContract>,
    pub rows: Vec<TabularReviewRow>,
    pub metrics: TabularReviewMetrics,
    pub applied_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct TabularReviewContract {
    pub contract_id: String,
    pub file_name: String,
    pub counterparty: String,
    pub matched_clause_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct TabularReviewRow {
    pub row_id: String,
    pub contract_id: String,
    pub file_name: String,
    pub counterparty: String,
    pub clause_id: String,
    pub clause_name: String,
    pub playbook_version: u64,
    pub clause_type: String,
    pub outcome: String,
    pub deviation_score: u8,
    pub confidence: String,
    pub evidence: String,
    pub rationale: String,
    pub applied: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct TabularReviewMetrics {
    pub contract_count: usize,
    pub matched_clause_count: usize,
    pub average_deviation: f64,
    pub red_line_breaches: usize,
    pub fallback_rows: usize,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ApplyInsightsRequest {
    pub row_ids: Option<Vec<String>>,
    pub include_low_confidence: Option<bool>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TextReviewRequest {
    pub contract_text: String,
    pub file_name: Option<String>,
}

#[utoipa::path(
    post,
    path = "/tabular-review",
    request_body(
        content = String,
        description = "Upload negotiated PDF or DOCX contracts as multipart/form-data fields named `file`.",
        content_type = "multipart/form-data"
    ),
    responses(
        (status = 201, description = "Tabular review session created.", body = TabularReviewSession),
        (status = 400, description = "Invalid upload or empty playbook."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Tabular Review"
)]
#[instrument(skip(multipart))]
pub async fn post_tabular_review(
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<TabularReviewSession>), (StatusCode, String)> {
    let mut uploaded_files = Vec::new();
    let mut saw_file_field = false;
    let mut uploader = ReviewUploader {
        role: "lawyer".to_string(),
        display_name: "Legal Counsel".to_string(),
        email: "legal@livebook.com".to_string(),
    };

    while let Some(field) = multipart.next_field().await.map_err(|err| {
        (
            StatusCode::BAD_REQUEST,
            format!("invalid multipart payload: {err}"),
        )
    })? {
        let field_name = field.name().map(str::to_owned);
        let file_name = field.file_name().map(str::to_owned);
        let content_type = field.content_type().map(str::to_owned);
        let bytes = field.bytes().await.map_err(|err| {
            (
                StatusCode::BAD_REQUEST,
                format!("failed to read multipart field: {err}"),
            )
        })?;

        if matches!(field_name.as_deref(), Some("file") | Some("files")) {
            saw_file_field = true;
            let file_name = file_name.unwrap_or_else(|| "contract".to_string());
            let kind = detect_contract_file_kind(&bytes, &file_name, content_type.as_deref())
                .ok_or_else(|| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("field `file` must contain a PDF or DOCX contract: {file_name}"),
                    )
                })?;
            uploaded_files.push(UploadedContractFile {
                bytes: bytes.to_vec(),
                file_name,
                kind,
            });
        } else {
            let value = String::from_utf8_lossy(&bytes).trim().to_string();
            match field_name.as_deref() {
                Some("uploader_role") => uploader.role = normalize_uploader_role(&value),
                Some("uploader_name") if !value.is_empty() => uploader.display_name = value,
                Some("uploader_email") if !value.is_empty() => uploader.email = value,
                _ => {}
            }
        }
    }

    if uploaded_files.is_empty() {
        return Err(if saw_file_field {
            (
                StatusCode::BAD_REQUEST,
                "field `file` must contain at least one supported contract".to_string(),
            )
        } else {
            (
                StatusCode::BAD_REQUEST,
                "multipart payload must include at least one `file` field".to_string(),
            )
        });
    }

    let playbook = read_playbook_array().await?;
    if playbook.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "current playbook is empty; upload a playbook before running tabular review"
                .to_string(),
        ));
    }

    let created_at = Utc::now().to_rfc3339();
    let session_id = format!(
        "TR-{}-{:016x}",
        Utc::now().format("%Y%m%dT%H%M%S"),
        fnv1a_64(created_at.as_bytes())
    );
    let mut analysis_jobs = Vec::new();

    for (idx, file) in uploaded_files.iter().enumerate() {
        let contract_id = format!(
            "{}:{}",
            session_id,
            slugify_identifier(&display_name_from_filename(&file.file_name))
        );
        let extracted = extract_contract_text(&session_id, idx, file).await?;
        analysis_jobs.push((contract_id, file.file_name.clone(), extracted));
    }

    let mut join_set = tokio::task::JoinSet::new();
    for (contract_id, file_name, extracted) in analysis_jobs {
        let playbook = playbook.clone();
        join_set.spawn(async move {
            let rows = analyze_contract(&contract_id, &file_name, &extracted, &playbook).await?;
            Ok::<_, (StatusCode, String)>((contract_id, file_name, rows))
        });
    }

    let mut contracts = Vec::new();
    let mut rows = Vec::new();
    while let Some(result) = join_set.join_next().await {
        let (contract_id, file_name, mut contract_rows) = result.map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("tabular review analysis task failed: {err}"),
            )
        })??;
        let counterparty = contract_rows
            .first()
            .map(|row| row.counterparty.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| display_name_from_filename(&file_name));

        for row in &mut contract_rows {
            row.counterparty = counterparty.clone();
        }
        let matched_clause_count = contract_rows.len();
        rows.extend(contract_rows);
        contracts.push(TabularReviewContract {
            contract_id,
            file_name,
            counterparty,
            matched_clause_count,
        });
    }

    let playbook_clause_count = playbook.len();
    let playbook_hash = format!("{:016x}", hash_json_fnv1a(&Value::Array(playbook)));
    let mut session = TabularReviewSession {
        session_id,
        created_at,
        status: "ready".to_string(),
        uploaded_by_role: uploader.role.clone(),
        escalation_id: None,
        playbook_hash,
        playbook_clause_count,
        contracts,
        rows,
        metrics: TabularReviewMetrics::default(),
        applied_at: None,
    };
    session.metrics = calculate_metrics(&session);
    if let Some(escalation_id) = maybe_escalate_business_tabular_review(&session, &uploader).await?
    {
        session.escalation_id = Some(escalation_id);
        session.status = "escalated".to_string();
    }

    let mut sessions = read_sessions().await?;
    sessions.push(session.clone());
    write_sessions(&sessions).await?;

    Ok((StatusCode::CREATED, Json(session)))
}

#[utoipa::path(
    post,
    path = "/tabular-review/text",
    request_body = TextReviewRequest,
    responses(
        (status = 201, description = "Word add-in text review session created.", body = TabularReviewSession),
        (status = 400, description = "Missing contract text or empty playbook."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Tabular Review"
)]
#[instrument(skip(body))]
pub async fn post_tabular_review_text(
    Json(body): Json<TextReviewRequest>,
) -> Result<(StatusCode, Json<TabularReviewSession>), (StatusCode, String)> {
    let contract_text = body.contract_text.trim();
    if contract_text.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "contract_text must not be empty".to_string(),
        ));
    }

    let playbook = read_playbook_array().await?;
    if playbook.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "cannot review contract because playbook is empty".to_string(),
        ));
    }

    let session_id = format!("TR-{}", Utc::now().format("%Y%m%d%H%M%S%3f"));
    let file_name = body
        .file_name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Word document".to_string());
    let contract_id = format!("{session_id}:word-document");
    let rows = analyze_contract(&contract_id, &file_name, contract_text, &playbook).await?;
    let counterparty = rows
        .first()
        .map(|row| row.counterparty.clone())
        .unwrap_or_else(|| display_name_from_filename(&file_name));
    let playbook_hash = format!(
        "{:016x}",
        fnv1a_64(
            serde_json::to_string(&playbook)
                .unwrap_or_default()
                .as_bytes()
        )
    );

    let mut session = TabularReviewSession {
        session_id,
        created_at: Utc::now().to_rfc3339(),
        status: "ready".to_string(),
        uploaded_by_role: "lawyer".to_string(),
        escalation_id: None,
        playbook_hash,
        playbook_clause_count: playbook.len(),
        contracts: vec![TabularReviewContract {
            contract_id,
            file_name,
            counterparty,
            matched_clause_count: rows.len(),
        }],
        rows,
        metrics: TabularReviewMetrics::default(),
        applied_at: None,
    };
    session.metrics = calculate_metrics(&session);

    let mut sessions = read_sessions().await?;
    sessions.push(session.clone());
    write_sessions(&sessions).await?;

    Ok((StatusCode::CREATED, Json(session)))
}

#[utoipa::path(
    get,
    path = "/tabular-review",
    responses(
        (status = 200, description = "All tabular review sessions.", body = Vec<TabularReviewSession>),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Tabular Review"
)]
#[instrument]
pub async fn get_tabular_reviews() -> Result<Json<Vec<TabularReviewSession>>, (StatusCode, String)>
{
    Ok(Json(read_sessions().await?))
}

#[utoipa::path(
    get,
    path = "/tabular-review/{session_id}",
    params(("session_id" = String, Path, description = "Tabular review session ID")),
    responses(
        (status = 200, description = "Single tabular review session.", body = TabularReviewSession),
        (status = 404, description = "Session not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Tabular Review"
)]
#[instrument]
pub async fn get_tabular_review(
    Path(session_id): Path<String>,
) -> Result<Json<TabularReviewSession>, (StatusCode, String)> {
    let session = read_sessions()
        .await?
        .into_iter()
        .find(|entry| entry.session_id == session_id)
        .ok_or((
            StatusCode::NOT_FOUND,
            "review session not found".to_string(),
        ))?;
    Ok(Json(session))
}

#[utoipa::path(
    post,
    path = "/tabular-review/{session_id}/apply-insights",
    params(("session_id" = String, Path, description = "Tabular review session ID")),
    request_body = ApplyInsightsRequest,
    responses(
        (status = 200, description = "Review insights applied to negotiation history.", body = TabularReviewSession),
        (status = 404, description = "Session or clause not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Tabular Review"
)]
#[instrument(skip(body))]
pub async fn apply_tabular_review_insights(
    Path(session_id): Path<String>,
    body: Option<Json<ApplyInsightsRequest>>,
) -> Result<Json<TabularReviewSession>, (StatusCode, String)> {
    let mut sessions = read_sessions().await?;
    let idx = sessions
        .iter()
        .position(|entry| entry.session_id == session_id)
        .ok_or((
            StatusCode::NOT_FOUND,
            "review session not found".to_string(),
        ))?;

    if sessions[idx].rows.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "review session has no rows to apply".to_string(),
        ));
    }

    if sessions[idx].applied_at.is_some() {
        return Ok(Json(sessions[idx].clone()));
    }

    let request = body.map(|Json(body)| body);
    let selected_ids = request
        .as_ref()
        .and_then(|body| body.row_ids.as_ref())
        .map(|ids| ids.iter().cloned().collect::<HashSet<_>>());
    let include_low_confidence = request
        .as_ref()
        .and_then(|body| body.include_low_confidence)
        .unwrap_or(false);

    let mut playbook = read_playbook_array().await?;
    let rows_to_apply = sessions[idx]
        .rows
        .iter()
        .filter(|row| should_apply_row(row, selected_ids.as_ref(), include_low_confidence))
        .cloned()
        .collect::<Vec<_>>();
    if rows_to_apply.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "review session has no eligible rows to apply".to_string(),
        ));
    }

    for row in &rows_to_apply {
        let clause_idx = find_clause_index(&playbook, &row.clause_id)?;
        let history_entry = json!({
            "contract_id": row.contract_id,
            "counterparty": row.counterparty,
            "outcome": row.outcome,
            "jurisdiction": "",
            "amount": "",
            "escalated": row.outcome == "red_line_breached",
            "date": Utc::now().format("%Y-%m-%d").to_string(),
            "source": "tabular_review",
            "review_session_id": sessions[idx].session_id,
            "evidence": row.evidence,
            "confidence": row.confidence
        });
        append_negotiation_history_once(&mut playbook[clause_idx], history_entry);
    }

    write_playbook_array(&playbook).await?;
    let _ = run_evolve_analysis().await;

    let applied_ids = rows_to_apply
        .iter()
        .map(|row| row.row_id.clone())
        .collect::<HashSet<_>>();
    for row in &mut sessions[idx].rows {
        if applied_ids.contains(&row.row_id) {
            row.applied = true;
        }
    }
    sessions[idx].applied_at = Some(Utc::now().to_rfc3339());
    sessions[idx].status = "insights_applied".to_string();
    let updated = sessions[idx].clone();
    write_sessions(&sessions).await?;

    Ok(Json(updated))
}

fn detect_contract_file_kind(
    bytes: &[u8],
    file_name: &str,
    content_type: Option<&str>,
) -> Option<ContractFileKind> {
    let lower_name = file_name.to_ascii_lowercase();
    let lower_mime = content_type.unwrap_or_default().to_ascii_lowercase();
    if lower_mime == "application/pdf"
        || lower_name.ends_with(".pdf")
        || bytes.starts_with(b"%PDF-")
    {
        return Some(ContractFileKind::Pdf);
    }
    if lower_name.ends_with(".docx")
        || lower_mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    {
        return Some(ContractFileKind::Docx);
    }
    None
}

async fn extract_contract_text(
    session_id: &str,
    idx: usize,
    file: &UploadedContractFile,
) -> Result<String, (StatusCode, String)> {
    match file.kind {
        ContractFileKind::Pdf => pdf_extract::extract_text_from_mem(&file.bytes).map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to extract PDF text from {}: {err}", file.file_name),
            )
        }),
        ContractFileKind::Docx => {
            fs::create_dir_all("tabular_review_uploads")
                .await
                .map_err(|err| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to create tabular upload directory: {err}"),
                    )
                })?;
            let file_path = format!(
                "tabular_review_uploads/{}_{}.{}",
                slugify_identifier(session_id),
                idx,
                file.kind.extension()
            );
            fs::write(&file_path, &file.bytes).await.map_err(|err| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!(
                        "failed to write uploaded contract {}: {err}",
                        file.file_name
                    ),
                )
            })?;
            let result = extract_docx_text(&file_path).await;
            let _ = fs::remove_file(&file_path).await;
            result
        }
    }
}

async fn extract_docx_text(file_path: &str) -> Result<String, (StatusCode, String)> {
    let output = Command::new("unzip")
        .arg("-p")
        .arg(file_path)
        .arg("word/document.xml")
        .output()
        .await
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to run unzip: {err}"),
            )
        })?;

    if !output.status.success() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!(
                "failed to read word/document.xml from DOCX: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        ));
    }

    Ok(strip_xml_to_text(&String::from_utf8_lossy(&output.stdout)))
}

async fn analyze_contract(
    contract_id: &str,
    file_name: &str,
    contract_text: &str,
    playbook: &[Value],
) -> Result<Vec<TabularReviewRow>, (StatusCode, String)> {
    let relevant_playbook = relevant_playbook_for_contract(contract_text, playbook);
    if std::env::var("OPENAI_API_KEY").is_ok() {
        match analyze_contract_with_openai(
            contract_id,
            file_name,
            contract_text,
            &relevant_playbook,
        )
        .await
        {
            Ok(rows) => {
                return Ok(rows_with_local_empty_fallback(
                    rows,
                    contract_id,
                    file_name,
                    contract_text,
                    &relevant_playbook,
                ));
            }
            Err((status, message)) => {
                warn!(%status, %message, "OpenAI tabular review failed; using local fallback");
            }
        }
    }
    Ok(analyze_contract_locally(
        contract_id,
        file_name,
        contract_text,
        &relevant_playbook,
    ))
}

fn rows_with_local_empty_fallback(
    rows: Vec<TabularReviewRow>,
    contract_id: &str,
    file_name: &str,
    contract_text: &str,
    playbook: &[Value],
) -> Vec<TabularReviewRow> {
    if !rows.is_empty() {
        return rows;
    }

    let fallback_rows = analyze_contract_locally(contract_id, file_name, contract_text, playbook);
    if fallback_rows.is_empty() {
        rows
    } else {
        warn!(
            fallback_row_count = fallback_rows.len(),
            "OpenAI tabular review returned no rows; using local fallback"
        );
        fallback_rows
    }
}

async fn analyze_contract_with_openai(
    contract_id: &str,
    file_name: &str,
    contract_text: &str,
    playbook: &[Value],
) -> Result<Vec<TabularReviewRow>, (StatusCode, String)> {
    let api_key = std::env::var("OPENAI_API_KEY").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "OPENAI_API_KEY is not configured".to_string(),
        )
    })?;
    let playbook_json = serde_json::to_string_pretty(&compact_playbook(playbook))
        .unwrap_or_else(|_| "[]".to_string());
    let contract_text = truncate_for_prompt(contract_text, MAX_CONTRACT_PROMPT_CHARS);
    let models = openai_tabular_model_candidates();
    let prompt = format!(
        "Review one negotiated NDA against the current playbook.\n\
         Return JSON only, no markdown, with exact shape:\n\
         {{\"counterparty\":\"string\",\"clauses\":[{{\"clause_id\":\"string\",\"outcome\":\"preferred|fallback_1|fallback_2|red_line_breached\",\"confidence\":\"low|medium|high\",\"evidence\":\"short contract excerpt\",\"rationale\":\"short explanation\"}}]}}\n\
         Rules:\n\
         - Use only clause_id values present in PLAYBOOK.\n\
         - Include a clause only if the contract contains enough evidence to classify it.\n\
         - Use red_line_breached when contract language appears to violate the red_line.\n\
         - Use fallback_1 or fallback_2 when contract language aligns closer to that fallback than preferred.\n\
         - Evidence must be copied or tightly paraphrased from the contract.\n\n\
         PLAYBOOK:\n{playbook_json}\n\n\
         CONTRACT FILE: {file_name}\n\
         CONTRACT TEXT:\n{contract_text}"
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(OPENAI_TABULAR_TIMEOUT_SECS))
        .build()
        .map_err(|err| {
            (
                StatusCode::BAD_GATEWAY,
                format!("failed to build OpenAI HTTP client: {err}"),
            )
        })?;
    let mut last_error = None;
    for model in models {
        match call_openai_tabular_model(&client, &api_key, &model, &prompt).await {
            Ok(parsed) => {
                return Ok(rows_from_extraction(
                    contract_id,
                    file_name,
                    &parsed,
                    playbook,
                ));
            }
            Err(err) => {
                let retry_next_model = is_model_access_error(&err.1);
                last_error = Some(err);
                if !retry_next_model {
                    break;
                }
            }
        }
    }

    Err(last_error.unwrap_or((
        StatusCode::BAD_GATEWAY,
        "OpenAI tabular review failed for all configured models".to_string(),
    )))
}

fn is_model_access_error(message: &str) -> bool {
    message.contains("model_not_found") || message.contains("does not have access to model")
}

async fn call_openai_tabular_model(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<Value, (StatusCode, String)> {
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
                format!("failed to call OpenAI API with {model}: {err}"),
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
            format!("OpenAI API error with {model} ({status}): {body}"),
        ));
    }

    let response_json: Value = response.json().await.map_err(|err| {
        (
            StatusCode::BAD_GATEWAY,
            format!("failed to decode OpenAI response from {model}: {err}"),
        )
    })?;
    let output = extract_output_text(&response_json).ok_or((
        StatusCode::BAD_GATEWAY,
        format!("OpenAI response from {model} did not contain text output"),
    ))?;
    serde_json::from_str(&strip_markdown_fence(&output)).map_err(|err| {
        (
            StatusCode::BAD_GATEWAY,
            format!("OpenAI output from {model} was not valid tabular review JSON: {err}"),
        )
    })
}

fn openai_tabular_model_candidates() -> Vec<String> {
    if let Ok(value) = std::env::var("OPENAI_TABULAR_MODEL") {
        let models = value
            .split(',')
            .map(str::trim)
            .filter(|model| !model.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>();
        if !models.is_empty() {
            return models;
        }
    }

    vec![DEFAULT_OPENAI_TABULAR_MODEL.to_string()]
}

fn analyze_contract_locally(
    contract_id: &str,
    file_name: &str,
    contract_text: &str,
    playbook: &[Value],
) -> Vec<TabularReviewRow> {
    let lower_text = contract_text.to_ascii_lowercase();
    let counterparty = infer_counterparty(contract_text)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| display_name_from_filename(file_name));
    let mut extraction_clauses = Vec::new();

    for clause in playbook {
        let clause_id = clause
            .get("clause_id")
            .and_then(Value::as_str)
            .unwrap_or("");
        if clause_id.is_empty() || !contract_matches_clause(&lower_text, clause) {
            continue;
        }
        let outcome = infer_outcome_for_clause(&lower_text, clause);
        extraction_clauses.push(json!({
            "clause_id": clause_id,
            "outcome": outcome,
            "confidence": "medium",
            "evidence": excerpt_for_clause(contract_text, clause),
            "rationale": "Matched contract text against clause name, keywords, positions, or red line."
        }));
    }

    rows_from_extraction(
        contract_id,
        file_name,
        &json!({ "counterparty": counterparty, "clauses": extraction_clauses }),
        playbook,
    )
}

fn relevant_playbook_for_contract(contract_text: &str, playbook: &[Value]) -> Vec<Value> {
    let lower_text = contract_text.to_ascii_lowercase();
    let looks_like_nda = lower_text.contains("non-disclosure")
        || lower_text.contains("confidentiality agreement")
        || lower_text.contains("confidential information");
    if !looks_like_nda {
        return playbook.to_vec();
    }

    let filtered = playbook
        .iter()
        .filter(|clause| {
            [
                clause.get("clause_id").and_then(Value::as_str),
                clause.get("original_clause_id").and_then(Value::as_str),
                clause.get("playbook_name").and_then(Value::as_str),
            ]
            .into_iter()
            .flatten()
            .any(|value| value.to_ascii_lowercase().contains("nda"))
        })
        .cloned()
        .collect::<Vec<_>>();
    if filtered.is_empty() {
        playbook.to_vec()
    } else {
        filtered
    }
}

fn rows_from_extraction(
    contract_id: &str,
    file_name: &str,
    extraction: &Value,
    playbook: &[Value],
) -> Vec<TabularReviewRow> {
    let counterparty = extraction
        .get("counterparty")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| display_name_from_filename(file_name));
    let clause_by_id = playbook
        .iter()
        .filter_map(|clause| {
            clause
                .get("clause_id")
                .and_then(Value::as_str)
                .map(|id| (id.to_string(), clause))
        })
        .collect::<HashMap<_, _>>();

    extraction
        .get("clauses")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let clause_id = item.get("clause_id").and_then(Value::as_str)?.to_string();
            let clause = clause_by_id.get(&clause_id)?;
            let outcome = normalize_outcome(item.get("outcome").and_then(Value::as_str));
            let deviation_score = outcome_score(&outcome);
            let row_seed = format!("{contract_id}:{clause_id}:{outcome}");
            Some(TabularReviewRow {
                row_id: format!("TRR-{:016x}", fnv1a_64(row_seed.as_bytes())),
                contract_id: contract_id.to_string(),
                file_name: file_name.to_string(),
                counterparty: counterparty.clone(),
                clause_id,
                clause_name: clause
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Unnamed clause")
                    .to_string(),
                playbook_version: clause
                    .get("meta")
                    .and_then(|meta| meta.get("version"))
                    .and_then(Value::as_u64)
                    .unwrap_or(1),
                clause_type: clause
                    .get("clause_type")
                    .and_then(Value::as_str)
                    .unwrap_or("General")
                    .to_string(),
                outcome,
                deviation_score,
                confidence: normalize_confidence(item.get("confidence").and_then(Value::as_str)),
                evidence: item
                    .get("evidence")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .chars()
                    .take(800)
                    .collect(),
                rationale: item
                    .get("rationale")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .chars()
                    .take(500)
                    .collect(),
                applied: false,
            })
        })
        .collect()
}

fn compact_playbook(playbook: &[Value]) -> Vec<Value> {
    playbook
        .iter()
        .map(|clause| {
            json!({
                "clause_id": clause.get("clause_id"),
                "name": clause.get("name"),
                "clause_type": clause.get("clause_type"),
                "positions": clause.get("positions"),
                "red_line": clause.get("red_line"),
                "escalation_trigger": clause.get("escalation_trigger"),
                "keywords": clause.get("keywords"),
                "meta": { "version": clause.get("meta").and_then(|meta| meta.get("version")) }
            })
        })
        .collect()
}

fn truncate_for_prompt(input: &str, max_chars: usize) -> String {
    let mut output = input.chars().take(max_chars).collect::<String>();
    if input.chars().count() > max_chars {
        output.push_str("\n\n[TRUNCATED FOR REVIEW]");
    }
    output
}

fn contract_matches_clause(lower_text: &str, clause: &Value) -> bool {
    let mut terms = Vec::new();
    for key in ["name", "clause_type", "red_line", "escalation_trigger"] {
        if let Some(value) = clause.get(key).and_then(Value::as_str) {
            terms.push(value.to_ascii_lowercase());
        }
    }
    if let Some(positions) = clause.get("positions").and_then(Value::as_object) {
        for value in positions.values().filter_map(Value::as_str) {
            terms.push(value.to_ascii_lowercase());
        }
    }
    if let Some(keywords) = clause.get("keywords").and_then(Value::as_array) {
        for value in keywords.iter().filter_map(Value::as_str) {
            terms.push(value.to_ascii_lowercase());
        }
    }

    terms
        .into_iter()
        .flat_map(|term| {
            term.split(|ch: char| !ch.is_ascii_alphanumeric())
                .filter(|part| part.len() > 4)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .any(|term| lower_text.contains(&term))
}

fn infer_outcome_for_clause(lower_text: &str, clause: &Value) -> &'static str {
    let clause_context = [
        clause.get("name").and_then(Value::as_str).unwrap_or(""),
        clause
            .get("clause_type")
            .and_then(Value::as_str)
            .unwrap_or(""),
    ]
    .join(" ")
    .to_ascii_lowercase();
    let red_line = clause
        .get("red_line")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    let liability_clause =
        clause_context.contains("liability") || clause_context.contains("indemnification");
    if (liability_clause
        && (lower_text.contains("unlimited") || lower_text.contains("without limitation")))
        || (!red_line.is_empty() && shared_token_count(lower_text, &red_line) >= 3)
    {
        return "red_line_breached";
    }
    if lower_text.contains("fallback 2") || lower_text.contains("fallback_2") {
        return "fallback_2";
    }
    if lower_text.contains("fallback 1")
        || lower_text.contains("fallback_1")
        || lower_text.contains("fallback")
    {
        return "fallback_1";
    }
    "preferred"
}

fn shared_token_count(haystack: &str, needle: &str) -> usize {
    needle
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|part| part.len() > 4)
        .filter(|part| haystack.contains(part))
        .count()
}

fn excerpt_for_clause(contract_text: &str, clause: &Value) -> String {
    let lower = contract_text.to_ascii_lowercase();
    let candidates = clause
        .get("keywords")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .chain(clause.get("name").and_then(Value::as_str))
        .map(|value| value.to_ascii_lowercase())
        .collect::<Vec<_>>();
    for candidate in candidates {
        if candidate.is_empty() {
            continue;
        }
        if let Some(start) = lower.find(&candidate) {
            let start = start.saturating_sub(120);
            let end = (start + 700).min(contract_text.len());
            return contract_text[start..end].trim().to_string();
        }
    }
    contract_text.chars().take(700).collect()
}

fn normalize_outcome(value: Option<&str>) -> String {
    match value
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "fallback_1" | "fallback 1" | "fallback-1" => "fallback_1".to_string(),
        "fallback_2" | "fallback 2" | "fallback-2" => "fallback_2".to_string(),
        "red_line_breached" | "red line breached" | "red-line-breached" | "redline" => {
            "red_line_breached".to_string()
        }
        _ => "preferred".to_string(),
    }
}

fn normalize_confidence(value: Option<&str>) -> String {
    match value
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "high" => "high".to_string(),
        "low" => "low".to_string(),
        _ => "medium".to_string(),
    }
}

fn normalize_uploader_role(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "business" | "business_user" => "business".to_string(),
        _ => "lawyer".to_string(),
    }
}

fn outcome_score(outcome: &str) -> u8 {
    match outcome {
        "fallback_1" => 1,
        "fallback_2" => 2,
        "red_line_breached" => 3,
        _ => 0,
    }
}

fn calculate_metrics(session: &TabularReviewSession) -> TabularReviewMetrics {
    let matched_clause_count = session.rows.len();
    let total_score: usize = session
        .rows
        .iter()
        .map(|row| row.deviation_score as usize)
        .sum();
    let average_deviation = if matched_clause_count == 0 {
        0.0
    } else {
        ((total_score as f64 / matched_clause_count as f64) * 100.0).round() / 100.0
    };

    TabularReviewMetrics {
        contract_count: session.contracts.len(),
        matched_clause_count,
        average_deviation,
        red_line_breaches: session
            .rows
            .iter()
            .filter(|row| row.outcome == "red_line_breached")
            .count(),
        fallback_rows: session
            .rows
            .iter()
            .filter(|row| row.outcome == "fallback_1" || row.outcome == "fallback_2")
            .count(),
    }
}

fn session_has_deviations(session: &TabularReviewSession) -> bool {
    session.rows.iter().any(|row| row.deviation_score > 0)
}

async fn maybe_escalate_business_tabular_review(
    session: &TabularReviewSession,
    uploader: &ReviewUploader,
) -> Result<Option<String>, (StatusCode, String)> {
    if uploader.role != "business" || !session_has_deviations(session) {
        return Ok(None);
    }

    let deviating_rows = session
        .rows
        .iter()
        .filter(|row| row.deviation_score > 0)
        .collect::<Vec<_>>();
    let mut clause_refs = deviating_rows
        .iter()
        .map(|row| format!("{} {}", row.clause_id, row.clause_name))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    clause_refs.sort();

    let red_lines = deviating_rows
        .iter()
        .filter(|row| row.outcome == "red_line_breached")
        .count();
    let fallback_rows = deviating_rows
        .iter()
        .filter(|row| row.outcome == "fallback_1" || row.outcome == "fallback_2")
        .count();

    let clause_ref = if clause_refs.is_empty() {
        "Tabular Review".to_string()
    } else {
        clause_refs
            .into_iter()
            .take(6)
            .collect::<Vec<_>>()
            .join(", ")
    };
    let contract_names = session
        .contracts
        .iter()
        .map(|contract| contract.file_name.clone())
        .collect::<Vec<_>>()
        .join(", ");

    let request = CreateEscalationRequest {
        query_id: None,
        created_by: EscalationActor {
            user_id: "local-business-user".to_string(),
            display_name: uploader.display_name.clone(),
            email: uploader.email.clone(),
            role: "business_user".to_string(),
        },
        created_from: EscalationSource {
            source: "tabular_review".to_string(),
            session_id: session.session_id.clone(),
            message_id: session.session_id.clone(),
        },
        lawyer: EscalationLawyer {
            user_id: "local-lawyer".to_string(),
            display_name: "Legal Counsel".to_string(),
            email: "legal@livebook.com".to_string(),
        },
        question: format!(
            "Business uploaded {} negotiated contract(s) for tabular review.",
            session.metrics.contract_count
        ),
        answer: format!(
            "Tabular review found {} deviation row(s): {} fallback row(s), {} red-line breach(es). Files: {}",
            deviating_rows.len(),
            fallback_rows,
            red_lines,
            contract_names
        ),
        clause_ref,
        position_used: "tabular_review_deviation".to_string(),
        escalation_reason: Some(format!(
            "Business upload produced deviations from the current playbook in session {}.",
            session.session_id
        )),
        next_action: "Open Tabular Review, inspect the deviation evidence, then generate or approve Evolve suggestions if appropriate.".to_string(),
    };

    let (item, _) = queue_escalation(request).await?;
    Ok(Some(item.id))
}

fn should_apply_row(
    row: &TabularReviewRow,
    selected_ids: Option<&HashSet<String>>,
    include_low_confidence: bool,
) -> bool {
    if row.applied {
        return false;
    }
    if let Some(selected_ids) = selected_ids {
        return selected_ids.contains(&row.row_id);
    }
    include_low_confidence || row.confidence != "low"
}

async fn read_sessions() -> Result<Vec<TabularReviewSession>, (StatusCode, String)> {
    store::list_tabular_review_sessions()
        .await
        .map_err(internal_error)?
        .into_iter()
        .map(|value| {
            serde_json::from_value(value).map_err(|err| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("stored tabular review session is invalid: {err}"),
                )
            })
        })
        .collect()
}

async fn write_sessions(sessions: &[TabularReviewSession]) -> Result<(), (StatusCode, String)> {
    for session in sessions {
        let payload = serde_json::to_value(session).map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to serialize tabular review session: {err}"),
            )
        })?;
        let rows = session
            .rows
            .iter()
            .cloned()
            .map(serde_json::to_value)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to serialize tabular review rows: {err}"),
                )
            })?;
        store::upsert_tabular_review_session(&session.session_id, &session.status, &payload)
            .await
            .map_err(internal_error)?;
        store::upsert_tabular_review_rows(&session.session_id, &rows)
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
    store::replace_playbook_documents(&Value::Array(clauses.to_vec()), "tabular_review_apply", None, None)
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

fn append_negotiation_history_once(clause: &mut Value, history_entry: Value) {
    let contract_id = history_entry
        .get("contract_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let session_id = history_entry
        .get("review_session_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    if let Some(object) = clause.as_object_mut() {
        let history = object
            .entry("negotiation_history".to_string())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(history_array) = history.as_array_mut() {
            let exists = history_array.iter().any(|entry| {
                entry.get("contract_id").and_then(Value::as_str) == Some(contract_id.as_str())
                    && entry.get("review_session_id").and_then(Value::as_str)
                        == Some(session_id.as_str())
            });
            if !exists {
                history_array.push(history_entry);
            }
        }
    }
}

fn infer_counterparty(text: &str) -> Option<String> {
    for marker in ["Counterparty:", "Customer:", "Client:", "Party:"] {
        if let Some(after) = text.split(marker).nth(1) {
            return after
                .lines()
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned);
        }
    }
    None
}

fn display_name_from_filename(file_name: &str) -> String {
    let stem = file_name
        .rsplit_once('.')
        .map(|(left, _)| left)
        .unwrap_or(file_name);
    stem.replace(['_', '-'], " ").trim().to_string()
}

fn slugify_identifier(input: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for ch in input.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            previous_dash = false;
        } else if !previous_dash && !slug.is_empty() {
            slug.push('-');
            previous_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "contract".to_string()
    } else {
        slug
    }
}

fn strip_xml_to_text(xml: &str) -> String {
    let mut text = String::with_capacity(xml.len());
    let mut in_tag = false;
    for ch in xml.chars() {
        match ch {
            '<' => {
                in_tag = true;
                text.push('\n');
            }
            '>' => in_tag = false,
            _ if !in_tag => text.push(ch),
            _ => {}
        }
    }
    collapse_blank_lines(&decode_xml_entities(&text))
}

fn decode_xml_entities(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn collapse_blank_lines(input: &str) -> String {
    let mut output = String::new();
    let mut previous_blank = false;
    for line in input.lines().map(str::trim) {
        if line.is_empty() {
            if !previous_blank {
                output.push('\n');
            }
            previous_blank = true;
        } else {
            if !output.is_empty() {
                output.push('\n');
            }
            output.push_str(line);
            previous_blank = false;
        }
    }
    output.trim().to_string()
}

fn extract_output_text(response_json: &Value) -> Option<String> {
    response_json
        .get("output_text")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| {
            response_json
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

fn hash_json_fnv1a(value: &Value) -> u64 {
    let serialized = serde_json::to_vec(value).unwrap_or_default();
    fnv1a_64(&serialized)
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

    fn sample_session(rows: Vec<TabularReviewRow>) -> TabularReviewSession {
        TabularReviewSession {
            session_id: "TR-1".to_string(),
            created_at: "2026-04-25T00:00:00Z".to_string(),
            status: "ready".to_string(),
            uploaded_by_role: "lawyer".to_string(),
            escalation_id: None,
            playbook_hash: "hash".to_string(),
            playbook_clause_count: 1,
            contracts: vec![TabularReviewContract {
                contract_id: "TR-1:contract".to_string(),
                file_name: "contract.pdf".to_string(),
                counterparty: "Acme".to_string(),
                matched_clause_count: rows.len(),
            }],
            rows,
            metrics: TabularReviewMetrics::default(),
            applied_at: None,
        }
    }

    fn sample_row(outcome: &str, confidence: &str) -> TabularReviewRow {
        TabularReviewRow {
            row_id: format!("row-{outcome}"),
            contract_id: "TR-1:contract".to_string(),
            file_name: "contract.pdf".to_string(),
            counterparty: "Acme".to_string(),
            clause_id: "C01".to_string(),
            clause_name: "Liability".to_string(),
            playbook_version: 1,
            clause_type: "Liability".to_string(),
            outcome: outcome.to_string(),
            deviation_score: outcome_score(outcome),
            confidence: confidence.to_string(),
            evidence: "evidence".to_string(),
            rationale: "rationale".to_string(),
            applied: false,
        }
    }

    #[test]
    fn outcome_score_uses_fixed_ordinal_mapping() {
        assert_eq!(outcome_score("preferred"), 0);
        assert_eq!(outcome_score("fallback_1"), 1);
        assert_eq!(outcome_score("fallback_2"), 2);
        assert_eq!(outcome_score("red_line_breached"), 3);
    }

    #[test]
    fn uploader_role_is_limited_to_business_or_lawyer() {
        assert_eq!(normalize_uploader_role("business"), "business");
        assert_eq!(normalize_uploader_role("business_user"), "business");
        assert_eq!(normalize_uploader_role("legal"), "lawyer");
    }

    #[test]
    fn session_deviation_detection_requires_non_preferred_rows() {
        assert!(!session_has_deviations(&sample_session(vec![sample_row(
            "preferred",
            "high"
        )])));
        assert!(session_has_deviations(&sample_session(vec![sample_row(
            "fallback_1",
            "high"
        )])));
    }

    #[test]
    fn metrics_count_red_lines_and_average_deviation() {
        let mut session = sample_session(vec![
            sample_row("preferred", "high"),
            sample_row("fallback_1", "high"),
            sample_row("red_line_breached", "high"),
        ]);
        session.metrics = calculate_metrics(&session);

        assert_eq!(session.metrics.contract_count, 1);
        assert_eq!(session.metrics.matched_clause_count, 3);
        assert_eq!(session.metrics.red_line_breaches, 1);
        assert_eq!(session.metrics.fallback_rows, 1);
        assert_eq!(session.metrics.average_deviation, 1.33);
    }

    #[test]
    fn low_confidence_rows_are_skipped_by_default() {
        let row = sample_row("fallback_1", "low");
        assert!(!should_apply_row(&row, None, false));
        assert!(should_apply_row(&row, None, true));
    }

    #[test]
    fn extraction_ignores_unknown_clause_ids() {
        let playbook = vec![json!({
            "clause_id": "C01",
            "name": "Liability",
            "meta": { "version": 2 }
        })];
        let rows = rows_from_extraction(
            "contract-1",
            "contract.pdf",
            &json!({
                "counterparty": "Acme",
                "clauses": [
                    { "clause_id": "C01", "outcome": "fallback 1", "confidence": "high" },
                    { "clause_id": "UNKNOWN", "outcome": "fallback_2", "confidence": "high" }
                ]
            }),
            &playbook,
        );

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].clause_id, "C01");
        assert_eq!(rows[0].outcome, "fallback_1");
        assert_eq!(rows[0].playbook_version, 2);
    }

    #[test]
    fn empty_openai_rows_use_local_fallback_when_text_matches_playbook() {
        let playbook = vec![json!({
            "clause_id": "NDA-01",
            "name": "Marking of Confidential Info",
            "clause_type": "Confidentiality",
            "keywords": ["marking", "confidential information"],
            "positions": {
                "preferred": "Require confidential information to be marked Confidential."
            },
            "meta": { "version": 2 }
        })];

        let rows = rows_with_local_empty_fallback(
            Vec::new(),
            "contract-1",
            "word-document",
            "This Non-Disclosure Agreement protects confidential information and includes a marking process.",
            &playbook,
        );

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].clause_id, "NDA-01");
        assert_eq!(rows[0].playbook_version, 2);
    }

    #[test]
    fn empty_openai_rows_stay_empty_when_local_fallback_has_no_match() {
        let playbook = vec![json!({
            "clause_id": "NDA-01",
            "name": "Marking of Confidential Info",
            "keywords": ["confidential information"]
        })];

        let rows = rows_with_local_empty_fallback(
            Vec::new(),
            "contract-1",
            "word-document",
            "A short services schedule about delivery milestones.",
            &playbook,
        );

        assert!(rows.is_empty());
    }

    #[test]
    fn nda_contracts_use_only_nda_playbook_clauses() {
        let playbook = vec![
            json!({
                "clause_id": "nda-playbook:NDA-01",
                "original_clause_id": "NDA-01",
                "playbook_name": "NDA Playbook"
            }),
            json!({
                "clause_id": "supply-playbook:SUP-01",
                "original_clause_id": "SUP-01",
                "playbook_name": "Supply Playbook"
            }),
        ];

        let relevant = relevant_playbook_for_contract(
            "Mutual Non-Disclosure Agreement for Confidential Information",
            &playbook,
        );

        assert_eq!(relevant.len(), 1);
        assert_eq!(relevant[0]["original_clause_id"], "NDA-01");
    }

    #[test]
    fn unlimited_text_only_forces_red_line_on_liability_clauses() {
        let nda_type_clause = json!({
            "name": "Type of NDA",
            "clause_type": "Confidentiality",
            "red_line": "Reject unilateral NDA"
        });
        let liability_clause = json!({
            "name": "Other Liabilities",
            "clause_type": "Liability",
            "red_line": "Reject unlimited liability"
        });
        let text = "liability is unlimited";

        assert_eq!(
            infer_outcome_for_clause(text, &nda_type_clause),
            "preferred"
        );
        assert_eq!(
            infer_outcome_for_clause(text, &liability_clause),
            "red_line_breached"
        );
    }

    #[test]
    fn append_negotiation_history_is_idempotent_per_session_contract() {
        let mut clause = json!({ "clause_id": "C01" });
        let entry = json!({
            "contract_id": "TR-1:contract",
            "review_session_id": "TR-1",
            "outcome": "fallback_1"
        });

        append_negotiation_history_once(&mut clause, entry.clone());
        append_negotiation_history_once(&mut clause, entry);

        assert_eq!(
            clause["negotiation_history"].as_array().map(Vec::len),
            Some(1)
        );
    }

    #[test]
    fn prompt_truncation_marks_long_contracts() {
        let text = "a".repeat(20);
        let truncated = truncate_for_prompt(&text, 5);

        assert!(truncated.starts_with("aaaaa"));
        assert!(truncated.contains("TRUNCATED"));
    }

    #[test]
    fn model_candidates_can_be_configured_as_csv() {
        unsafe {
            std::env::set_var("OPENAI_TABULAR_MODEL", "model-a, model-b");
        }
        let candidates = openai_tabular_model_candidates();
        unsafe {
            std::env::remove_var("OPENAI_TABULAR_MODEL");
        }

        assert_eq!(candidates, vec!["model-a", "model-b"]);
    }

    #[test]
    fn model_retry_only_for_access_errors() {
        assert!(is_model_access_error("model_not_found"));
        assert!(is_model_access_error("does not have access to model `x`"));
        assert!(!is_model_access_error("request timed out"));
    }
}
