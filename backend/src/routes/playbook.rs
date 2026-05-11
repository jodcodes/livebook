use axum::{
    Json,
    extract::{Multipart, Path, Query},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, HashMap, HashSet};
use tokio::{fs, io::AsyncWriteExt, process::Command};
use tracing::{info, instrument, warn};
use utoipa::{IntoParams, ToSchema};

use crate::repositories::store;
use crate::routes::evolve::run_evolve_analysis;
use crate::services::retrieval;

#[derive(Debug, Clone, Copy)]
enum PlaybookFileKind {
    Pdf,
    Docx,
    Xlsx,
}

impl PlaybookFileKind {
    fn extension(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Docx => "docx",
            Self::Xlsx => "xlsx",
        }
    }
}

struct UploadedPlaybookFile {
    bytes: Vec<u8>,
    file_name: String,
    kind: PlaybookFileKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UploaderRole {
    Business,
    Lawyer,
}

impl UploaderRole {
    fn from_field(value: Option<&str>) -> Self {
        match value
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "lawyer" | "legal" | "legal_counsel" | "legal-counsel" => Self::Lawyer,
            _ => Self::Business,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Business => "business",
            Self::Lawyer => "lawyer",
        }
    }
}

#[derive(Debug, Clone)]
struct UploaderContext {
    role: UploaderRole,
    name: String,
    email: Option<String>,
}

struct ExistingPlaybookMetadata {
    name: String,
    playbook_type: String,
    party_name: String,
    law_type: String,
}

#[derive(Deserialize, ToSchema)]
pub struct ClauseApprovalRequest {
    pub approved_by: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub struct ClauseDeclineRequest {
    pub declined_by: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub struct VersionCompareRequest {
    pub from_version_id: String,
    pub to_version_id: String,
    pub audience: Option<String>,
    pub question: Option<String>,
}

#[derive(Serialize, Clone, ToSchema)]
pub struct VersionFieldDiff {
    pub field: String,
    pub from: String,
    pub to: String,
}

#[derive(Serialize, Clone, ToSchema)]
pub struct VersionCompareResponse {
    pub from_version_id: String,
    pub to_version_id: String,
    pub audience: String,
    pub clause_id: String,
    pub clause_name: String,
    pub explanation: String,
    pub changed_fields: Vec<VersionFieldDiff>,
}

#[derive(Serialize, ToSchema)]
pub struct PlaybookSummary {
    pub id: String,
    pub name: String,
    pub playbook_type: String,
    pub party_name: String,
    pub law_type: String,
    pub clause_count: usize,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct HistoryQuery {
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct ClauseHistoryResponse {
    pub history: Vec<Value>,
}

#[utoipa::path(
    post,
    path = "/playbook",
    request_body(
        content = String,
        description = "Upload PDF, DOCX, or XLSX as multipart/form-data field named `file`.",
        content_type = "multipart/form-data"
    ),
    responses(
        (status = 201, description = "Playbook extracted, transformed to JSON, and hashed snapshot written."),
        (status = 400, description = "Invalid multipart payload or missing playbook file."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument(skip(multipart))]
pub async fn post_playbook(
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), (StatusCode, String)> {
    let mut uploaded_files: Vec<UploadedPlaybookFile> = Vec::new();
    let mut saw_file_field = false;
    let mut upload_mode = "create".to_string();
    let mut target_playbook_id: Option<String> = None;
    let mut playbook_name: Option<String> = None;
    let mut playbook_type: Option<String> = None;
    let mut party_name: Option<String> = None;
    let mut law_type: Option<String> = None;
    let mut uploaded_by_role: Option<String> = None;
    let mut uploaded_by_name: Option<String> = None;
    let mut uploaded_by_email: Option<String> = None;

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

        match field_name.as_deref() {
            Some("file") => {
                saw_file_field = true;
                let file_name = file_name.unwrap_or_else(|| "playbook".to_string());
                let kind = detect_playbook_file_kind(&bytes, &file_name, content_type.as_deref())
                    .ok_or_else(|| {
                        (
                            StatusCode::BAD_REQUEST,
                            format!(
                                "multipart field `file` must contain a PDF, DOCX, or XLSX file: {file_name}"
                            ),
                        )
                    })?;
                uploaded_files.push(UploadedPlaybookFile {
                    bytes: bytes.to_vec(),
                    file_name,
                    kind,
                });
            }
            Some("upload_mode") => {
                let value = String::from_utf8_lossy(&bytes).trim().to_ascii_lowercase();
                if !value.is_empty() {
                    upload_mode = value;
                }
            }
            Some("target_playbook_id") => {
                let value = String::from_utf8_lossy(&bytes).trim().to_string();
                if !value.is_empty() {
                    target_playbook_id = Some(value);
                }
            }
            Some("playbook_name") => {
                let value = String::from_utf8_lossy(&bytes).trim().to_string();
                if !value.is_empty() {
                    playbook_name = Some(value);
                }
            }
            Some("playbook_type") => {
                let value = String::from_utf8_lossy(&bytes).trim().to_string();
                if !value.is_empty() {
                    playbook_type = Some(value);
                }
            }
            Some("party_name") => {
                let value = String::from_utf8_lossy(&bytes).trim().to_string();
                if !value.is_empty() {
                    party_name = Some(value);
                }
            }
            Some("law_type") => {
                let value = String::from_utf8_lossy(&bytes).trim().to_string();
                if !value.is_empty() {
                    law_type = Some(value);
                }
            }
            Some("uploaded_by_role") => {
                let value = String::from_utf8_lossy(&bytes).trim().to_string();
                if !value.is_empty() {
                    uploaded_by_role = Some(value);
                }
            }
            Some("uploaded_by_name") => {
                let value = String::from_utf8_lossy(&bytes).trim().to_string();
                if !value.is_empty() {
                    uploaded_by_name = Some(value);
                }
            }
            Some("uploaded_by_email") => {
                let value = String::from_utf8_lossy(&bytes).trim().to_string();
                if !value.is_empty() {
                    uploaded_by_email = Some(value);
                }
            }
            _ => {}
        }
    }

    if uploaded_files.is_empty() {
        return Err(if saw_file_field {
            (
                StatusCode::BAD_REQUEST,
                "multipart field `file` must contain a PDF, DOCX, or XLSX file".to_string(),
            )
        } else {
            (
                StatusCode::BAD_REQUEST,
                "multipart payload must include at least one `file` field".to_string(),
            )
        });
    }
    if upload_mode != "create" && upload_mode != "update" {
        return Err((
            StatusCode::BAD_REQUEST,
            "upload_mode must be `create` or `update`".to_string(),
        ));
    }
    if upload_mode == "update" && target_playbook_id.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            "target_playbook_id is required when upload_mode is `update`".to_string(),
        ));
    }

    let first_file_name = uploaded_files
        .first()
        .map(|file| file.file_name.clone())
        .unwrap_or_else(|| "Uploaded Playbook".to_string());
    let playbook_name =
        playbook_name.unwrap_or_else(|| display_name_from_filename(&first_file_name));
    let playbook_type = normalize_playbook_type(playbook_type.as_deref());
    let party_name = party_name.unwrap_or_else(|| default_party_name(&playbook_type));
    let law_type = normalize_law_type(law_type.as_deref(), &playbook_name);
    let uploader_role = UploaderRole::from_field(uploaded_by_role.as_deref());
    let uploader = UploaderContext {
        role: uploader_role,
        name: uploaded_by_name.unwrap_or_else(|| {
            if uploader_role == UploaderRole::Lawyer {
                "Legal Counsel".to_string()
            } else {
                "Business User".to_string()
            }
        }),
        email: uploaded_by_email,
    };

    info!(
        file_count = uploaded_files.len(),
        playbook_name,
        playbook_type,
        party_name,
        law_type,
        uploaded_by_role = uploader.role.as_str(),
        "received playbook source files"
    );

    fs::create_dir_all("playbook").await.map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to create playbook directory: {err}"),
        )
    })?;

    let nonce = Utc::now().format("%Y%m%dT%H%M%S%3f").to_string();
    let playbook_id = format!("{}-{nonce}", slugify_identifier(&playbook_name));
    let playbook_json_path = "playbook/playbook.json";

    let process_result: Result<(StatusCode, Value), (StatusCode, String)> = async {
        let mut extracted_sections = Vec::new();
        for (idx, file) in uploaded_files.iter().enumerate() {
            let file_path = format!("playbook/playbook_{nonce}_{idx}.{}", file.kind.extension());
            let raw_txt_path = format!("playbook/playbook_{nonce}_{idx}_raw.txt");

            fs::write(&file_path, &file.bytes).await.map_err(|err| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to write uploaded file {}: {err}", file.file_name),
                )
            })?;

            let extracted =
                extract_uploaded_playbook_text(&file_path, &raw_txt_path, &file.bytes, file.kind)
                    .await?;
            extracted_sections.push(format!(
                "\n\nSOURCE FILE: {}\n{}\n",
                file.file_name, extracted
            ));

            let _ = fs::remove_file(&file_path).await;
            let _ = fs::remove_file(&raw_txt_path).await;
        }

        let extracted = extracted_sections.join("\n");
        let cleaned = clean_extracted_text(&extracted);
        let mut extracted_playbook = build_playbook_json_with_openai(&cleaned).await?;
        normalize_playbook_value(&mut extracted_playbook);

        let previous_playbook = read_playbook_or_null().await?;
        let mut existing_clauses = match previous_playbook.clone() {
            Value::Array(clauses) => clauses,
            Value::Null => Vec::new(),
            _ => {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "existing playbook JSON must be an array".to_string(),
                ));
            }
        };
        normalize_playbook_clauses(&mut existing_clauses);

        let mut existing_ids: HashSet<String> = existing_clauses
            .iter()
            .filter_map(|clause| {
                clause
                    .get("clause_id")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .collect();
        let ingest_created_at = Utc::now().to_rfc3339();
        let source_files = uploaded_files
            .iter()
            .map(|file| file.file_name.clone())
            .collect::<Vec<_>>();
        if upload_mode == "update" {
            let target_id = target_playbook_id.as_deref().unwrap_or_default();
            let target_meta = existing_playbook_metadata(&existing_clauses, target_id)?;
            stamp_uploaded_playbook(
                &mut extracted_playbook,
                target_id,
                &target_meta.name,
                &target_meta.playbook_type,
                &target_meta.party_name,
                &target_meta.law_type,
                &ingest_created_at,
                &source_files,
                &uploader,
                &mut existing_ids,
            );
            let draft_response = create_playbook_update_draft(
                target_id,
                &existing_clauses,
                extracted_playbook,
                &cleaned,
                &source_files,
                &uploader,
            )
            .await?;
            return Ok((StatusCode::OK, draft_response));
        }

        stamp_uploaded_playbook(
            &mut extracted_playbook,
            &playbook_id,
            &playbook_name,
            &playbook_type,
            &party_name,
            &law_type,
            &ingest_created_at,
            &source_files,
            &uploader,
            &mut existing_ids,
        );
        write_raw_source_segments(&extracted_playbook, &cleaned).await?;

        let mut new_clauses = match extracted_playbook {
            Value::Array(clauses) => clauses,
            Value::Null => Vec::new(),
            _ => unreachable!("normalize_playbook_value produces an array for objects"),
        };
        let clause_count = new_clauses.len();
        let version_ids = new_clauses
            .iter_mut()
            .map(|clause| ensure_clause_version_id(clause))
            .collect::<Vec<_>>();
        existing_clauses.append(&mut new_clauses);
        let current = Value::Array(existing_clauses);

        persist_current_playbook(&current, "post").await?;
        write_playbook_change_history(&previous_playbook, &current, "post").await?;
        record_playbook_version(&current, &playbook_id, "create", true, &version_ids).await?;
        let _ = retrieval::refresh_embeddings_for_playbook(&current).await;
        Ok((
            StatusCode::CREATED,
            json!({
                "kind": "created",
                "playbook_id": playbook_id.clone(),
                "playbook_name": playbook_name.clone(),
                "clause_count": clause_count,
                "review_status": if uploader.role == UploaderRole::Lawyer {
                    "approved"
                } else {
                    "pending"
                },
                "version_ids": version_ids,
            }),
        ))
    }
    .await;

    let (status, response) = process_result?;
    let _ = run_evolve_analysis().await;
    info!(
        output_path = %playbook_json_path,
        upload_mode,
        "playbook json extraction finished"
    );

    Ok((status, Json(response)))
}

#[utoipa::path(
    post,
    path = "/playbook/uploads/{draft_id}/confirm",
    params(("draft_id" = String, Path, description = "Draft upload ID")),
    responses(
        (status = 200, description = "Draft playbook update applied.", body = Value),
        (status = 404, description = "Draft not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument]
pub async fn confirm_playbook_upload_draft(
    Path(draft_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let draft = read_upload_draft(&draft_id).await?;
    let target_playbook_id = draft
        .get("target_playbook_id")
        .and_then(Value::as_str)
        .ok_or((
            StatusCode::BAD_REQUEST,
            "draft is missing target_playbook_id".to_string(),
        ))?
        .to_string();
    let draft_clauses = draft
        .get("clauses")
        .and_then(Value::as_array)
        .cloned()
        .ok_or((
            StatusCode::BAD_REQUEST,
            "draft is missing clauses".to_string(),
        ))?;
    let changed_clause_ids = draft
        .get("changed_clause_ids")
        .and_then(Value::as_array)
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let previous = read_playbook_or_null().await?;
    let mut current_clauses = match previous.clone() {
        Value::Array(clauses) => clauses,
        Value::Null => Vec::new(),
        _ => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "existing playbook JSON must be an array".to_string(),
            ));
        }
    };
    current_clauses.retain(|clause| {
        clause.get("playbook_id").and_then(Value::as_str) != Some(target_playbook_id.as_str())
    });
    current_clauses.extend(draft_clauses);
    let mut current = Value::Array(current_clauses);
    normalize_playbook_value(&mut current);

    persist_current_playbook(&current, "playbook_update_confirm").await?;

    if let Some(segments) = draft.get("raw_source_segments").and_then(Value::as_object) {
        merge_raw_source_segments(segments.clone()).await?;
    }
    write_playbook_change_history(&previous, &current, "playbook_update_confirm").await?;
    record_playbook_version(
        &current,
        &target_playbook_id,
        "playbook_update",
        true,
        &changed_clause_ids,
    )
    .await?;
    let _ = retrieval::refresh_embeddings_for_playbook(&current).await;
    let _ = fs::remove_file(upload_draft_path(&draft_id)).await;
    let _ = run_evolve_analysis().await;

    Ok(Json(json!({
        "kind": "updated",
        "playbook_id": target_playbook_id,
        "changed_clause_ids": changed_clause_ids,
    })))
}

fn detect_playbook_file_kind(
    bytes: &[u8],
    file_name: &str,
    content_type: Option<&str>,
) -> Option<PlaybookFileKind> {
    let lower_name = file_name.to_ascii_lowercase();
    let lower_mime = content_type.unwrap_or_default().to_ascii_lowercase();
    if lower_mime == "application/pdf"
        || lower_name.ends_with(".pdf")
        || bytes.starts_with(b"%PDF-")
    {
        return Some(PlaybookFileKind::Pdf);
    }
    if lower_name.ends_with(".docx")
        || lower_mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    {
        return Some(PlaybookFileKind::Docx);
    }
    if lower_name.ends_with(".xlsx")
        || lower_mime == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    {
        return Some(PlaybookFileKind::Xlsx);
    }
    None
}

fn normalize_playbook_type(input: Option<&str>) -> String {
    match input
        .unwrap_or("opposite_party")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "opposite" | "opposite_party" | "opposite-party" | "counterparty" => {
            "opposite_party".to_string()
        }
        _ => "opposite_party".to_string(),
    }
}

fn default_party_name(playbook_type: &str) -> String {
    let _ = playbook_type;
    "Globex GmbH".to_string()
}

fn normalize_law_type(input: Option<&str>, fallback_text: &str) -> String {
    let candidate = input.unwrap_or(fallback_text).trim().to_ascii_lowercase();
    let label = if candidate.contains("smart infrastructure")
        || candidate.contains("energy")
        || candidate.contains("grid")
        || candidate.contains("renewable")
        || candidate.contains("building")
        || candidate.contains("electrification")
        || candidate.contains("power")
    {
        "Smart Infrastructure / Energy"
    } else if candidate.contains("digital industries")
        || candidate.contains("automation")
        || candidate.contains("factory")
        || candidate.contains("industrial")
        || candidate.contains("plm")
    {
        "Digital Industries / Automation"
    } else if candidate.contains("data")
        || candidate.contains("privacy")
        || candidate.contains("gdpr")
        || candidate.contains("cyber")
    {
        "Data Privacy & Cybersecurity"
    } else if candidate.contains("procurement")
        || candidate.contains("supplier")
        || candidate.contains("purchasing")
        || candidate.contains("supply chain")
    {
        "Procurement & Supply Chain"
    } else if candidate.contains("software")
        || candidate.contains("ip")
        || candidate.contains("intellectual")
        || candidate.contains("license")
        || candidate.contains("licensing")
    {
        "Software, IP & Licensing"
    } else if candidate.contains("export")
        || candidate.contains("sanction")
        || candidate.contains("trade")
    {
        "Export Control & Sanctions"
    } else if candidate.contains("competition") || candidate.contains("antitrust") {
        "Competition & Antitrust"
    } else if candidate.contains("mobility")
        || candidate.contains("rail")
        || candidate.contains("rolling stock")
        || candidate.contains("signaling")
    {
        "Mobility & Rail"
    } else if candidate.contains("healthcare")
        || candidate.contains("healthineers")
        || candidate.contains("medtech")
        || candidate.contains("medical")
    {
        "Healthcare & MedTech"
    } else if candidate.contains("employment")
        || candidate.contains("labor")
        || candidate.contains("works council")
    {
        "Employment & Works Council"
    } else if candidate.contains("corporate")
        || candidate.contains("governance")
        || candidate.contains("m&a")
        || candidate.contains("merger")
    {
        "Corporate Governance & M&A"
    } else if candidate.contains("esg")
        || candidate.contains("sustainability")
        || candidate.contains("environment")
    {
        "ESG & Sustainability"
    } else if candidate.contains("real estate")
        || candidate.contains("facility")
        || candidate.contains("facilities")
        || candidate.contains("lease")
    {
        "Real Estate & Facilities"
    } else {
        input
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("General Commercial")
    };
    label.to_string()
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
        "playbook".to_string()
    } else {
        slug
    }
}

async fn extract_uploaded_playbook_text(
    file_path: &str,
    raw_txt_path: &str,
    bytes: &[u8],
    kind: PlaybookFileKind,
) -> Result<String, (StatusCode, String)> {
    match kind {
        PlaybookFileKind::Pdf => extract_pdf_text(file_path, raw_txt_path, bytes).await,
        PlaybookFileKind::Docx => extract_docx_text(file_path).await,
        PlaybookFileKind::Xlsx => extract_xlsx_text(file_path).await,
    }
}

async fn extract_docx_text(file_path: &str) -> Result<String, (StatusCode, String)> {
    let xml = unzip_entry(file_path, "word/document.xml").await?;
    Ok(strip_xml_to_text(&xml))
}

async fn extract_xlsx_text(file_path: &str) -> Result<String, (StatusCode, String)> {
    let entries = list_zip_entries(file_path).await?;
    let shared_strings = match unzip_entry(file_path, "xl/sharedStrings.xml").await {
        Ok(xml) => extract_xml_text_nodes(&xml, "t"),
        Err(_) => Vec::new(),
    };

    let mut sections = Vec::new();
    if !shared_strings.is_empty() {
        sections.push(format!("Shared strings:\n{}", shared_strings.join("\n")));
    }

    for entry in entries
        .into_iter()
        .filter(|entry| entry.starts_with("xl/worksheets/") && entry.ends_with(".xml"))
    {
        if let Ok(xml) = unzip_entry(file_path, &entry).await {
            sections.push(format!(
                "Worksheet {entry}:\n{}",
                xlsx_sheet_to_text(&xml, &shared_strings)
            ));
        }
    }

    if sections.is_empty() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to extract text from XLSX workbook".to_string(),
        ));
    }

    Ok(sections.join("\n\n"))
}

async fn unzip_entry(file_path: &str, entry: &str) -> Result<String, (StatusCode, String)> {
    let output = Command::new("unzip")
        .arg("-p")
        .arg(file_path)
        .arg(entry)
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
                "failed to read {entry} from uploaded archive: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn list_zip_entries(file_path: &str) -> Result<Vec<String>, (StatusCode, String)> {
    let output = Command::new("unzip")
        .arg("-Z1")
        .arg(file_path)
        .output()
        .await
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to list uploaded archive: {err}"),
            )
        })?;

    if !output.status.success() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!(
                "failed to list uploaded archive: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect())
}

fn extract_xml_text_nodes(xml: &str, tag_name: &str) -> Vec<String> {
    let open = format!("<{tag_name}");
    let close = format!("</{tag_name}>");
    let mut values = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(&open) {
        rest = &rest[start..];
        let Some(open_end) = rest.find('>') else {
            break;
        };
        rest = &rest[open_end + 1..];
        let Some(close_start) = rest.find(&close) else {
            break;
        };
        let value = decode_xml_entities(&rest[..close_start]);
        if !value.trim().is_empty() {
            values.push(value.trim().to_string());
        }
        rest = &rest[close_start + close.len()..];
    }
    values
}

fn xlsx_sheet_to_text(xml: &str, shared_strings: &[String]) -> String {
    let mut values = Vec::new();
    for cell in xml.split("<c ").skip(1) {
        let cell_end = cell.find("</c>").unwrap_or(cell.len());
        let cell_xml = &cell[..cell_end];
        let is_shared = cell_xml.contains(" t=\"s\"") || cell_xml.contains(" t=\"str\"");
        if is_shared {
            if let Some(raw) = first_xml_node_text(cell_xml, "v") {
                if let Ok(index) = raw.trim().parse::<usize>() {
                    if let Some(value) = shared_strings.get(index) {
                        values.push(value.clone());
                        continue;
                    }
                }
                values.push(raw);
            }
        } else if let Some(value) =
            first_xml_node_text(cell_xml, "v").or_else(|| first_xml_node_text(cell_xml, "t"))
        {
            values.push(value);
        }
    }
    values.join("\n")
}

fn first_xml_node_text(xml: &str, tag_name: &str) -> Option<String> {
    extract_xml_text_nodes(xml, tag_name).into_iter().next()
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

fn stamp_uploaded_playbook(
    playbook: &mut Value,
    playbook_id: &str,
    playbook_name: &str,
    playbook_type: &str,
    party_name: &str,
    law_type: &str,
    created_at: &str,
    source_files: &[String],
    uploader: &UploaderContext,
    existing_ids: &mut HashSet<String>,
) {
    let Some(clauses) = playbook.as_array_mut() else {
        return;
    };

    for (idx, clause) in clauses.iter_mut().enumerate() {
        let derived_clause_type = derive_clause_type(clause);
        let Some(object) = clause.as_object_mut() else {
            continue;
        };
        let original_clause_id = object
            .get("clause_id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("CLAUSE-{}", idx + 1));
        let base_id = format!("{playbook_id}:{original_clause_id}");
        let mut unique_id = base_id.clone();
        let mut suffix = 2;
        while existing_ids.contains(&unique_id) {
            unique_id = format!("{base_id}-{suffix}");
            suffix += 1;
        }
        existing_ids.insert(unique_id.clone());

        object.insert("clause_id".to_string(), Value::String(unique_id.clone()));
        object
            .entry("original_clause_id".to_string())
            .or_insert_with(|| Value::String(original_clause_id));
        object.insert(
            "playbook_id".to_string(),
            Value::String(playbook_id.to_string()),
        );
        object.insert(
            "playbook_name".to_string(),
            Value::String(playbook_name.to_string()),
        );
        object.insert(
            "playbook_type".to_string(),
            Value::String(playbook_type.to_string()),
        );
        object.insert(
            "party_name".to_string(),
            Value::String(party_name.to_string()),
        );
        object.insert("law_type".to_string(), Value::String(law_type.to_string()));
        object.insert(
            "source_files".to_string(),
            Value::Array(
                source_files
                    .iter()
                    .map(|file_name| Value::String(file_name.clone()))
                    .collect(),
            ),
        );
        let clause_type = object
            .get("clause_type")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or(derived_clause_type);
        object.insert("clause_type".to_string(), Value::String(clause_type));
        let meta = object
            .entry("meta".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(meta_object) = meta.as_object_mut() {
            let review_status = if uploader.role == UploaderRole::Lawyer {
                "approved"
            } else {
                "pending"
            };
            meta_object
                .entry("created_at".to_string())
                .or_insert_with(|| Value::String(created_at.to_string()));
            meta_object.insert(
                "created_by".to_string(),
                Value::String(uploader.name.clone()),
            );
            meta_object.insert(
                "created_by_role".to_string(),
                Value::String(uploader.role.as_str().to_string()),
            );
            if let Some(email) = &uploader.email {
                meta_object.insert("created_by_email".to_string(), Value::String(email.clone()));
            }
            meta_object
                .entry("created_from".to_string())
                .or_insert_with(|| Value::String("playbook_ingest".to_string()));
            meta_object
                .entry("version".to_string())
                .or_insert_with(|| Value::Number(1.into()));
            meta_object.insert(
                "review_status".to_string(),
                Value::String(review_status.to_string()),
            );
            meta_object.insert(
                "version_id".to_string(),
                Value::String(generate_version_id(&unique_id, 1, "ingest")),
            );
            if uploader.role == UploaderRole::Lawyer {
                meta_object.insert(
                    "approved_by".to_string(),
                    Value::String(uploader.name.clone()),
                );
            } else {
                meta_object.remove("approved_by");
            }
        }
    }
}

fn existing_playbook_metadata(
    clauses: &[Value],
    playbook_id: &str,
) -> Result<ExistingPlaybookMetadata, (StatusCode, String)> {
    let clause = clauses
        .iter()
        .find(|clause| clause.get("playbook_id").and_then(Value::as_str) == Some(playbook_id))
        .ok_or((
            StatusCode::NOT_FOUND,
            "target playbook not found".to_string(),
        ))?;
    let playbook_type = clause
        .get("playbook_type")
        .and_then(Value::as_str)
        .unwrap_or("opposite_party")
        .to_string();
    Ok(ExistingPlaybookMetadata {
        name: clause
            .get("playbook_name")
            .and_then(Value::as_str)
            .unwrap_or("Default Playbook")
            .to_string(),
        playbook_type: playbook_type.clone(),
        party_name: clause
            .get("party_name")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| default_party_name(&playbook_type)),
        law_type: clause
            .get("law_type")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| derive_law_type(clause)),
    })
}

async fn create_playbook_update_draft(
    target_playbook_id: &str,
    existing_clauses: &[Value],
    extracted_playbook: Value,
    raw_text: &str,
    source_files: &[String],
    uploader: &UploaderContext,
) -> Result<Value, (StatusCode, String)> {
    let target_existing = existing_clauses
        .iter()
        .filter(|clause| {
            clause.get("playbook_id").and_then(Value::as_str) == Some(target_playbook_id)
        })
        .cloned()
        .collect::<Vec<_>>();
    if target_existing.is_empty() {
        return Err((
            StatusCode::NOT_FOUND,
            "target playbook not found".to_string(),
        ));
    }

    let incoming = match extracted_playbook {
        Value::Array(clauses) => clauses,
        _ => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "extracted playbook must be an array".to_string(),
            ));
        }
    };

    let mut by_original = HashMap::new();
    let mut by_name = HashMap::new();
    for (index, clause) in target_existing.iter().enumerate() {
        if let Some(key) = clause_original_key(clause) {
            by_original.insert(key, index);
        }
        if let Some(key) = clause_name_key(clause) {
            by_name.insert(key, index);
        }
    }

    let mut matched_existing = HashSet::new();
    let mut final_clauses = Vec::new();
    let mut added = Vec::new();
    let mut updated = Vec::new();
    let mut unchanged = Vec::new();
    let mut changed_clause_ids = Vec::new();
    let mut raw_segments = Map::new();

    for mut incoming_clause in incoming {
        let match_index = clause_original_key(&incoming_clause)
            .and_then(|key| by_original.get(&key).copied())
            .or_else(|| {
                clause_name_key(&incoming_clause).and_then(|key| by_name.get(&key).copied())
            });

        if let Some(existing_index) = match_index {
            matched_existing.insert(existing_index);
            let existing = &target_existing[existing_index];
            let clause_id = existing
                .get("clause_id")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            set_string_field(&mut incoming_clause, "clause_id", &clause_id);
            copy_stable_playbook_fields(existing, &mut incoming_clause);

            let diffs = collect_version_diffs(existing, &incoming_clause);
            if diffs.is_empty() {
                preserve_existing_audit_fields(existing, &mut incoming_clause);
                unchanged.push(json!({
                    "clause_id": clause_id,
                    "name": incoming_clause.get("name").and_then(Value::as_str).unwrap_or("Unnamed clause")
                }));
            } else {
                let mut history_source = existing.clone();
                append_clause_history_entry(&mut history_source, &uploader.name, "playbook_update");
                if let Some(history) = history_source.get("history").cloned() {
                    set_value_field(&mut incoming_clause, "history", history);
                }
                let next_version = meta_version(existing) + 1;
                set_meta_number(&mut incoming_clause, "version", next_version);
                if let Some(previous_id) = meta_string(existing, "version_id") {
                    set_meta_string(&mut incoming_clause, "previous_version_id", &previous_id);
                }
                assign_fresh_version_id(&mut incoming_clause, "playbook_update");
                updated.push(json!({
                    "clause_id": clause_id,
                    "name": incoming_clause.get("name").and_then(Value::as_str).unwrap_or("Unnamed clause"),
                    "changed_fields": diffs
                }));
                changed_clause_ids.push(clause_id.clone());
            }
            raw_segments.insert(
                clause_id,
                Value::String(extract_raw_segment_for_clause(&incoming_clause, raw_text)),
            );
            final_clauses.push(incoming_clause);
            continue;
        }

        let clause_id = incoming_clause
            .get("clause_id")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        added.push(json!({
            "clause_id": clause_id,
            "name": incoming_clause.get("name").and_then(Value::as_str).unwrap_or("Unnamed clause")
        }));
        changed_clause_ids.push(clause_id.clone());
        raw_segments.insert(
            clause_id,
            Value::String(extract_raw_segment_for_clause(&incoming_clause, raw_text)),
        );
        final_clauses.push(incoming_clause);
    }

    let removed = target_existing
        .iter()
        .enumerate()
        .filter(|(index, _)| !matched_existing.contains(index))
        .map(|(_, clause)| {
            let clause_id = clause
                .get("clause_id")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            changed_clause_ids.push(clause_id.clone());
            json!({
                "clause_id": clause_id,
                "name": clause.get("name").and_then(Value::as_str).unwrap_or("Unnamed clause")
            })
        })
        .collect::<Vec<_>>();

    let draft_id = generate_upload_draft_id(target_playbook_id);
    let draft = json!({
        "draft_id": draft_id,
        "target_playbook_id": target_playbook_id,
        "created_at": Utc::now().to_rfc3339(),
        "source_files": source_files,
        "clauses": final_clauses,
        "raw_source_segments": raw_segments,
        "changed_clause_ids": changed_clause_ids,
        "diff": {
            "added": added,
            "updated": updated,
            "removed": removed,
            "unchanged": unchanged
        }
    });
    write_upload_draft(&draft_id, &draft).await?;

    Ok(json!({
        "kind": "draft",
        "draft_id": draft_id,
        "target_playbook_id": target_playbook_id,
        "diff": draft.get("diff").cloned().unwrap_or_else(|| json!({})),
        "changed_clause_ids": draft.get("changed_clause_ids").cloned().unwrap_or_else(|| json!([]))
    }))
}

fn clause_original_key(clause: &Value) -> Option<String> {
    clause
        .get("original_clause_id")
        .or_else(|| clause.get("clause_id"))
        .and_then(Value::as_str)
        .map(normalize_match_key)
        .filter(|value| !value.is_empty())
}

fn clause_name_key(clause: &Value) -> Option<String> {
    clause
        .get("name")
        .and_then(Value::as_str)
        .map(normalize_match_key)
        .filter(|value| !value.is_empty())
}

fn normalize_match_key(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn copy_stable_playbook_fields(from: &Value, to: &mut Value) {
    for key in [
        "playbook_id",
        "playbook_name",
        "playbook_type",
        "party_name",
        "law_type",
    ] {
        if let Some(value) = from.get(key).cloned() {
            set_value_field(to, key, value);
        }
    }
}

fn preserve_existing_audit_fields(from: &Value, to: &mut Value) {
    for key in ["history", "meta"] {
        if let Some(value) = from.get(key).cloned() {
            set_value_field(to, key, value);
        }
    }
}

fn set_string_field(value: &mut Value, key: &str, field_value: &str) {
    set_value_field(value, key, Value::String(field_value.to_string()));
}

fn set_value_field(value: &mut Value, key: &str, field_value: Value) {
    if let Some(object) = value.as_object_mut() {
        object.insert(key.to_string(), field_value);
    }
}

fn derive_clause_type(clause: &Value) -> String {
    let name = clause.get("name").and_then(Value::as_str).unwrap_or("");
    let lower = name.to_ascii_lowercase();
    let label = if lower.contains("liability") || lower.contains("indemn") {
        "Liability"
    } else if lower.contains("intellectual") || lower.contains(" ip ") || lower.contains("know-how")
    {
        "Intellectual Property"
    } else if lower.contains("confidential") || lower.contains("nda") || lower.contains("marking") {
        "Confidentiality"
    } else if lower.contains("term") || lower.contains("termination") || lower.contains("period") {
        "Term and Termination"
    } else if lower.contains("law") || lower.contains("dispute") || lower.contains("jurisdiction") {
        "Governing Law and Disputes"
    } else if lower.contains("signature") || lower.contains("authority") {
        "Signatures"
    } else if lower.contains("data") || lower.contains("privacy") || lower.contains("gdpr") {
        "Data Protection"
    } else if lower.contains("payment") {
        "Payment"
    } else if lower.contains("warranty") {
        "Warranty"
    } else {
        name.split(['-', '—', ':'])
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("General")
    };
    label.to_string()
}

fn derive_law_type(clause: &Value) -> String {
    let mut text_parts = Vec::new();
    for key in [
        "law_type",
        "playbook_name",
        "name",
        "clause_type",
        "red_line",
    ] {
        if let Some(value) = clause.get(key).and_then(Value::as_str) {
            text_parts.push(value);
        }
    }
    if let Some(keywords) = clause.get("keywords").and_then(Value::as_array) {
        for keyword in keywords {
            if let Some(value) = keyword.as_str() {
                text_parts.push(value);
            }
        }
    }
    normalize_law_type(None, &text_parts.join(" "))
}

fn normalize_playbook_clauses(clauses: &mut [Value]) {
    for clause in clauses {
        normalize_clause(clause);
    }
}

fn clean_extracted_text(input: &str) -> String {
    input
        .replace('\u{200b}', "")
        .replace("<200b>", "")
        .replace('\u{000C}', "")
        .replace("^L", "")
}

async fn extract_pdf_text(
    pdf_path: &str,
    raw_txt_path: &str,
    pdf_bytes: &[u8],
) -> Result<String, (StatusCode, String)> {
    match Command::new("pdftotext")
        .arg(pdf_path)
        .arg(raw_txt_path)
        .output()
        .await
    {
        Ok(output) if output.status.success() => {
            fs::read_to_string(raw_txt_path).await.map_err(|err| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to read extracted text: {err}"),
                )
            })
        }
        Ok(output) => {
            warn!(
                stderr = %String::from_utf8_lossy(&output.stderr).trim(),
                "pdftotext failed; falling back to Rust PDF extraction"
            );
            extract_pdf_text_from_bytes(pdf_bytes).map_err(|err| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to extract PDF text: {err}"),
                )
            })
        }
        Err(err) => {
            warn!(%err, "pdftotext unavailable; falling back to Rust PDF extraction");
            extract_pdf_text_from_bytes(pdf_bytes).map_err(|fallback_err| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to extract PDF text: {fallback_err}"),
                )
            })
        }
    }
}

fn extract_pdf_text_from_bytes(pdf_bytes: &[u8]) -> Result<String, String> {
    pdf_extract::extract_text_from_mem(pdf_bytes).map_err(|err| err.to_string())
}

#[utoipa::path(
    patch,
    path = "/playbook",
    request_body = String,
    responses(
        (status = 201, description = "Playbook JSON updated and hashed snapshot refreshed."),
        (status = 400, description = "Request body is missing or invalid JSON."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument(fields(body_len = body.len()), skip(body))]
pub async fn patch_playbook(body: String) -> Result<StatusCode, (StatusCode, String)> {
    if body.trim().is_empty() {
        warn!("empty playbook patch body");
        return Err((
            StatusCode::BAD_REQUEST,
            "request body must contain playbook data".to_string(),
        ));
    }

    let incoming: Value = serde_json::from_str(&body).map_err(|err| {
        (
            StatusCode::BAD_REQUEST,
            format!("patch body must be valid JSON: {err}"),
        )
    })?;

    fs::create_dir_all("playbook").await.map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to create playbook directory: {err}"),
        )
    })?;

    let current_raw = match fs::read_to_string("playbook/playbook.json").await {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => "null".to_string(),
        Err(err) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to read playbook JSON file: {err}"),
            ));
        }
    };

    let current: Value = serde_json::from_str(&current_raw).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("existing playbook JSON is invalid: {err}"),
        )
    })?;

    let mut current_arr = match current {
        Value::Array(arr) => arr,
        Value::Null => Vec::new(),
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                "existing playbook JSON must be an array".to_string(),
            ));
        }
    };

    let incoming_arr = match incoming {
        Value::Array(arr) => arr,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                "patch body must be a JSON array".to_string(),
            ));
        }
    };

    if incoming_arr.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "patch array must contain at least one object".to_string(),
        ));
    }

    let mut clause_index_by_id = build_clause_index_by_id(&current_arr)?;
    validate_upsert_array_structure(&current_arr, &incoming_arr, &clause_index_by_id)?;

    let previous = Value::Array(current_arr.clone());
    let current_hash = hash_json_fnv1a(&previous);
    let incoming_hash = hash_json_fnv1a(&Value::Array(incoming_arr.clone()));
    let mut changed_sections = Vec::new();
    let mut changed_playbook_ids = HashSet::new();

    for incoming_entry in incoming_arr {
        let clause_id = clause_id_from_entry(&incoming_entry)?.to_string();
        if let Some(playbook_id) = incoming_entry.get("playbook_id").and_then(Value::as_str) {
            changed_playbook_ids.insert(playbook_id.to_string());
        }
        if let Some(&idx) = clause_index_by_id.get(&clause_id) {
            current_arr[idx] = incoming_entry;
            changed_sections.push(format!("[{idx}]"));
            continue;
        }

        current_arr.push(incoming_entry);
        let idx = current_arr.len() - 1;
        clause_index_by_id.insert(clause_id, idx);
        changed_sections.push(format!("[{idx}]"));
    }

    let mut current = Value::Array(current_arr);
    normalize_playbook_value(&mut current);

    let merged_hash = hash_json_fnv1a(&current);
    persist_current_playbook(&current, "patch").await?;
    write_playbook_change_history(&previous, &current, "patch").await?;
    for playbook_id in &changed_playbook_ids {
        record_playbook_version(&current, playbook_id, "bulk_patch", true, &Vec::new()).await?;
    }
    let _ = retrieval::refresh_embeddings_for_playbook(&current).await;
    let _ = run_evolve_analysis().await;

    info!(
        current_hash,
        incoming_hash,
        merged_hash,
        changed_sections = ?changed_sections,
        "playbook json patch applied using FNV-1a diff detection"
    );

    Ok(StatusCode::CREATED)
}

#[utoipa::path(
    get,
    path = "/playbook",
    responses(
        (status = 200, description = "All clauses with computed dashboard status.", body = Vec<Value>),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument]
pub async fn get_playbook() -> Result<Json<Value>, (StatusCode, String)> {
    let mut clauses = read_playbook_array().await?;
    for clause in &mut clauses {
        add_computed_status(clause);
    }
    clauses.sort_by(sort_clause_dashboard);
    Ok(Json(Value::Array(clauses)))
}

#[utoipa::path(
    get,
    path = "/playbooks",
    responses(
        (status = 200, description = "Available playbooks grouped from stored clauses.", body = Vec<PlaybookSummary>),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument]
pub async fn get_playbooks() -> Result<Json<Vec<PlaybookSummary>>, (StatusCode, String)> {
    let clauses = read_playbook_array().await?;
    let mut grouped: BTreeMap<String, PlaybookSummary> = BTreeMap::new();

    for clause in clauses {
        let playbook_id = clause
            .get("playbook_id")
            .and_then(Value::as_str)
            .unwrap_or("default")
            .to_string();
        let playbook_name = clause
            .get("playbook_name")
            .and_then(Value::as_str)
            .unwrap_or("Default Playbook")
            .to_string();
        let playbook_type = clause
            .get("playbook_type")
            .and_then(Value::as_str)
            .unwrap_or("opposite_party")
            .to_string();
        let party_name = clause
            .get("party_name")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| default_party_name(&playbook_type));
        let law_type = clause
            .get("law_type")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| derive_law_type(&clause));
        let entry = grouped
            .entry(playbook_id.clone())
            .or_insert_with(|| PlaybookSummary {
                id: playbook_id,
                name: playbook_name,
                playbook_type,
                party_name,
                law_type,
                clause_count: 0,
            });
        entry.clause_count += 1;
    }

    Ok(Json(grouped.into_values().collect()))
}

#[utoipa::path(
    get,
    path = "/playbooks/{playbook_id}/versions",
    params(("playbook_id" = String, Path, description = "Playbook ID")),
    responses(
        (status = 200, description = "Playbook version timeline.", body = Value),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument]
pub async fn get_playbook_versions(
    Path(playbook_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let versions = playbook_versions_for(&playbook_id).await?;
    Ok(Json(Value::Array(versions)))
}

#[utoipa::path(
    get,
    path = "/playbooks/{playbook_id}/versions/{version_id}",
    params(
        ("playbook_id" = String, Path, description = "Playbook ID"),
        ("version_id" = String, Path, description = "Playbook version ID")
    ),
    responses(
        (status = 200, description = "Playbook version detail.", body = Value),
        (status = 404, description = "Playbook version not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument]
pub async fn get_playbook_version_detail(
    Path((playbook_id, version_id)): Path<(String, String)>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let versions = playbook_versions_for(&playbook_id).await?;
    let index = versions
        .iter()
        .position(|entry| {
            entry.get("version_id").and_then(Value::as_str) == Some(version_id.as_str())
        })
        .ok_or((
            StatusCode::NOT_FOUND,
            "playbook version not found".to_string(),
        ))?;
    let mut detail = versions[index].clone();
    let previous = if index + 1 < versions.len() {
        versions.get(index + 1)
    } else {
        None
    };
    let diff = playbook_version_detail_diff(previous, &detail);
    if let Some(object) = detail.as_object_mut() {
        object.insert("diff".to_string(), diff);
    }
    Ok(Json(detail))
}

#[utoipa::path(
    get,
    path = "/playbook/{clause_id}",
    params(("clause_id" = String, Path, description = "Clause ID")),
    responses(
        (status = 200, description = "Clause with raw source segment.", body = Value),
        (status = 404, description = "Clause not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument]
pub async fn get_playbook_clause(
    Path(clause_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let clauses = read_playbook_array().await?;
    let mut clause = clauses
        .into_iter()
        .find(|entry| entry.get("clause_id").and_then(Value::as_str) == Some(clause_id.as_str()))
        .ok_or((StatusCode::NOT_FOUND, "clause not found".to_string()))?;

    let raw_segments = read_raw_source_segments().await?;
    let raw_source_segment = raw_segments
        .get(&clause_id)
        .and_then(Value::as_str)
        .unwrap_or("No source text available")
        .to_string();

    add_computed_status(&mut clause);
    if let Some(object) = clause.as_object_mut() {
        object.insert(
            "raw_source_segment".to_string(),
            Value::String(raw_source_segment),
        );
    }
    Ok(Json(clause))
}

#[utoipa::path(
    get,
    path = "/playbook/review",
    responses(
        (status = 200, description = "Clauses sorted for lawyer review.", body = Vec<Value>),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument]
pub async fn get_playbook_review() -> Result<Json<Value>, (StatusCode, String)> {
    let mut clauses = read_playbook_array().await?;
    clauses.sort_by(sort_clause_review);
    Ok(Json(Value::Array(clauses)))
}

#[utoipa::path(
    patch,
    path = "/playbook/{clause_id}",
    params(("clause_id" = String, Path, description = "Clause ID")),
    request_body = Value,
    responses(
        (status = 200, description = "Clause partially updated.", body = Value),
        (status = 400, description = "Invalid patch body."),
        (status = 404, description = "Clause not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument(skip(body))]
pub async fn patch_playbook_clause(
    Path(clause_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    if !body.is_object() {
        return Err((
            StatusCode::BAD_REQUEST,
            "clause patch body must be a JSON object".to_string(),
        ));
    }

    let mut clauses = read_playbook_array().await?;
    let idx = find_clause_index(&clauses, &clause_id)?;
    append_clause_history_entry(&mut clauses[idx], "editor", "edit");
    deep_merge(&mut clauses[idx], &body);
    increment_meta_version(&mut clauses[idx], "edit");
    set_meta_string(&mut clauses[idx], "review_status", "pending");
    normalize_clause(&mut clauses[idx]);
    let updated = clauses[idx].clone();
    let playbook_id = updated
        .get("playbook_id")
        .and_then(Value::as_str)
        .unwrap_or("default")
        .to_string();
    write_playbook_array(&clauses, "clause_patch").await?;
    record_playbook_version(
        &Value::Array(clauses.clone()),
        &playbook_id,
        "clause_patch",
        false,
        &[clause_id.clone()],
    )
    .await?;
    if body.get("negotiation_history").is_some() {
        let _ = run_evolve_analysis().await;
    }
    Ok(Json(updated))
}

#[utoipa::path(
    post,
    path = "/playbook/{clause_id}/approve",
    params(("clause_id" = String, Path, description = "Clause ID")),
    request_body = ClauseApprovalRequest,
    responses(
        (status = 200, description = "Clause approved.", body = Value),
        (status = 404, description = "Clause not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument(skip(body))]
pub async fn approve_playbook_clause(
    Path(clause_id): Path<String>,
    body: Option<Json<ClauseApprovalRequest>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let approved_by = body
        .and_then(|Json(body)| body.approved_by)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "lawyer".to_string());
    let mut clauses = read_playbook_array().await?;
    let idx = find_clause_index(&clauses, &clause_id)?;
    set_meta_string(&mut clauses[idx], "review_status", "approved");
    set_meta_string(&mut clauses[idx], "approved_by", &approved_by);
    set_meta_string(&mut clauses[idx], "approved_at", &Utc::now().to_rfc3339());
    normalize_clause(&mut clauses[idx]);
    let updated = clauses[idx].clone();
    write_playbook_array(&clauses, "clause_approve").await?;
    Ok(Json(updated))
}

#[utoipa::path(
    post,
    path = "/playbook/{clause_id}/decline",
    params(("clause_id" = String, Path, description = "Clause ID")),
    request_body = ClauseDeclineRequest,
    responses(
        (status = 200, description = "Clause declined.", body = Value),
        (status = 404, description = "Clause not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument(skip(body))]
pub async fn decline_playbook_clause(
    Path(clause_id): Path<String>,
    body: Option<Json<ClauseDeclineRequest>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let declined_by = body
        .and_then(|Json(body)| body.declined_by)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "lawyer".to_string());
    let mut clauses = read_playbook_array().await?;
    let idx = find_clause_index(&clauses, &clause_id)?;
    set_meta_string(&mut clauses[idx], "review_status", "declined");
    set_meta_string(&mut clauses[idx], "declined_by", &declined_by);
    set_meta_string(&mut clauses[idx], "declined_at", &Utc::now().to_rfc3339());
    normalize_clause(&mut clauses[idx]);
    let updated = clauses[idx].clone();
    write_playbook_array(&clauses, "clause_decline").await?;
    Ok(Json(updated))
}

#[utoipa::path(
    get,
    path = "/playbook/{clause_id}/history",
    params(
        ("clause_id" = String, Path, description = "Clause ID"),
        HistoryQuery
    ),
    responses(
        (status = 200, description = "Clause history entries oldest first.", body = ClauseHistoryResponse),
        (status = 404, description = "Clause not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument]
pub async fn get_clause_history(
    Path(clause_id): Path<String>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let clauses = read_playbook_array().await?;
    let clause = clauses
        .iter()
        .find(|entry| entry.get("clause_id").and_then(Value::as_str) == Some(clause_id.as_str()))
        .ok_or((StatusCode::NOT_FOUND, "clause not found".to_string()))?;
    let mut history = clause
        .get("history")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    history
        .retain(|entry| history_entry_in_range(entry, query.from.as_deref(), query.to.as_deref()));
    Ok(Json(Value::Array(history)))
}

#[utoipa::path(
    post,
    path = "/playbook/versions/compare/explain",
    request_body = VersionCompareRequest,
    responses(
        (status = 200, description = "Plain-language explanation of two playbook versions.", body = VersionCompareResponse),
        (status = 400, description = "Invalid version IDs."),
        (status = 404, description = "Version ID not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument(skip(body))]
pub async fn explain_version_compare(
    Json(body): Json<VersionCompareRequest>,
) -> Result<Json<VersionCompareResponse>, (StatusCode, String)> {
    compare_versions(
        &body.from_version_id,
        &body.to_version_id,
        body.audience.as_deref().unwrap_or("business"),
        body.question.as_deref(),
    )
    .await
    .map(Json)
}

pub async fn compare_versions(
    from_version_id: &str,
    to_version_id: &str,
    audience: &str,
    question: Option<&str>,
) -> Result<VersionCompareResponse, (StatusCode, String)> {
    if from_version_id.trim().is_empty() || to_version_id.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "from_version_id and to_version_id are required".to_string(),
        ));
    }

    let clauses = read_playbook_array().await?;
    let from = find_version_snapshot(&clauses, from_version_id)
        .ok_or((StatusCode::NOT_FOUND, "from version not found".to_string()))?;
    let to = find_version_snapshot(&clauses, to_version_id)
        .ok_or((StatusCode::NOT_FOUND, "to version not found".to_string()))?;

    let changed_fields = collect_version_diffs(&from.snapshot, &to.snapshot);
    let explanation = build_version_explanation(&from, &to, &changed_fields, audience, question);
    Ok(VersionCompareResponse {
        from_version_id: from.version_id,
        to_version_id: to.version_id,
        audience: normalize_compare_audience(audience).to_string(),
        clause_id: to.clause_id,
        clause_name: to.clause_name,
        explanation,
        changed_fields,
    })
}

#[utoipa::path(
    post,
    path = "/playbook/{clause_id}/restore/{version}",
    params(
        ("clause_id" = String, Path, description = "Clause ID"),
        ("version" = u64, Path, description = "Version to restore")
    ),
    responses(
        (status = 200, description = "Clause restored to historical snapshot.", body = Value),
        (status = 404, description = "Clause or version not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument]
pub async fn restore_clause_version(
    Path((clause_id, version)): Path<(String, u64)>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut clauses = read_playbook_array().await?;
    let idx = find_clause_index(&clauses, &clause_id)?;
    let history_entry = clauses[idx]
        .get("history")
        .and_then(Value::as_array)
        .and_then(|history| {
            history
                .iter()
                .find(|entry| entry.get("version").and_then(Value::as_u64) == Some(version))
        })
        .cloned()
        .ok_or((
            StatusCode::NOT_FOUND,
            "history version not found".to_string(),
        ))?;
    let snapshot = history_entry.get("fields_snapshot").cloned().ok_or((
        StatusCode::NOT_FOUND,
        "history version snapshot not found".to_string(),
    ))?;
    let restored_from_version_id = history_entry
        .get("version_id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| {
            snapshot
                .get("meta")
                .and_then(|meta| meta.get("version_id"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        });

    let current_version = meta_version(&clauses[idx]);
    let existing_history = clauses[idx]
        .get("history")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    append_clause_history_entry(&mut clauses[idx], "lawyer", "restore");
    let appended_history = clauses[idx]
        .get("history")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or(existing_history);

    if let (Some(clause), Some(snapshot_object)) =
        (clauses[idx].as_object_mut(), snapshot.as_object())
    {
        for (key, value) in snapshot_object {
            if key != "history" {
                clause.insert(key.clone(), value.clone());
            }
        }
        clause.insert("history".to_string(), Value::Array(appended_history));
    }
    set_meta_number(&mut clauses[idx], "version", current_version + 1);
    set_meta_string(&mut clauses[idx], "review_status", "approved");
    if let Some(version_id) = restored_from_version_id {
        set_meta_string(&mut clauses[idx], "restored_from_version_id", &version_id);
    }
    assign_fresh_version_id(&mut clauses[idx], "restore");
    normalize_clause(&mut clauses[idx]);
    let updated = clauses[idx].clone();
    let playbook_id = updated
        .get("playbook_id")
        .and_then(Value::as_str)
        .unwrap_or("default")
        .to_string();
    write_playbook_array(&clauses, "clause_restore").await?;
    record_playbook_version(
        &Value::Array(clauses.clone()),
        &playbook_id,
        "clause_restore",
        false,
        &[clause_id.clone()],
    )
    .await?;
    Ok(Json(updated))
}

#[utoipa::path(
    get,
    path = "/playbook/history",
    responses(
        (status = 200, description = "Full .playbook history contents including CURRENT and history.log.", body = Value),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Playbook"
)]
#[instrument]
pub async fn get_playbook_history() -> Result<Json<Value>, (StatusCode, String)> {
    let mut directory = fs::read_dir(".playbook").await.map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to read .playbook directory: {err}"),
        )
    })?;

    let mut files = serde_json::Map::new();

    while let Some(entry) = directory.next_entry().await.map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to iterate .playbook directory: {err}"),
        )
    })? {
        let file_type = entry.file_type().await.map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to inspect .playbook entry type: {err}"),
            )
        })?;
        if !file_type.is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        let content = fs::read_to_string(entry.path()).await.map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to read .playbook/{file_name}: {err}"),
            )
        })?;

        let value = if file_name.ends_with(".json") {
            serde_json::from_str::<Value>(&content).unwrap_or_else(|_| Value::String(content))
        } else {
            Value::String(content)
        };
        files.insert(file_name, value);
    }

    Ok(Json(json!({
        "path": ".playbook",
        "files": files
    })))
}

async fn read_playbook_array() -> Result<Vec<Value>, (StatusCode, String)> {
    let mut value = read_playbook_or_null().await?;
    normalize_playbook_value_with_created_at(&mut value, playbook_file_modified_at().await);
    match value {
        Value::Array(clauses) => Ok(clauses),
        Value::Null => Ok(Vec::new()),
        _ => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "playbook JSON must be an array".to_string(),
        )),
    }
}

async fn playbook_file_modified_at() -> Option<String> {
    let metadata = fs::metadata("playbook/playbook.json").await.ok()?;
    let modified = metadata.modified().ok()?;
    let modified_at: DateTime<Utc> = modified.into();
    Some(modified_at.to_rfc3339())
}

async fn write_playbook_array(
    clauses: &[Value],
    operation: &str,
) -> Result<(), (StatusCode, String)> {
    let previous = read_playbook_or_null().await?;
    let current = Value::Array(clauses.to_vec());
    persist_current_playbook(&current, operation).await?;
    write_playbook_change_history(&previous, &current, operation).await
}

fn find_clause_index(clauses: &[Value], clause_id: &str) -> Result<usize, (StatusCode, String)> {
    clauses
        .iter()
        .position(|entry| entry.get("clause_id").and_then(Value::as_str) == Some(clause_id))
        .ok_or((StatusCode::NOT_FOUND, "clause not found".to_string()))
}

fn normalize_playbook_value(value: &mut Value) {
    normalize_playbook_value_with_created_at(value, None);
}

fn normalize_playbook_value_with_created_at(
    value: &mut Value,
    fallback_created_at: Option<String>,
) {
    match value {
        Value::Object(_) => {
            let mut wrapped = Value::Array(vec![value.take()]);
            normalize_playbook_value_with_created_at(&mut wrapped, fallback_created_at);
            *value = wrapped;
        }
        Value::Array(clauses) => {
            for clause in clauses {
                normalize_clause_with_created_at(clause, fallback_created_at.as_deref());
            }
        }
        _ => {}
    }
}

fn normalize_clause(clause: &mut Value) {
    normalize_clause_with_created_at(clause, None);
}

fn normalize_clause_with_created_at(clause: &mut Value, fallback_created_at: Option<&str>) {
    let low_confidence = is_clause_low_confidence(clause);
    let clause_type = derive_clause_type(clause);
    let law_type = derive_law_type(clause);
    let original_clause_id = clause
        .get("clause_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let created_at = clause_created_at(clause)
        .or_else(|| fallback_created_at.map(str::to_owned))
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let created_by = clause
        .get("meta")
        .and_then(|meta| meta.get("created_by"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            clause
                .get("meta")
                .and_then(|meta| meta.get("approved_by"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or("Legal Counsel")
        .to_string();
    let fallback_version_id = stable_version_id(clause);
    let Some(object) = clause.as_object_mut() else {
        return;
    };
    object.insert("low_confidence".to_string(), Value::Bool(low_confidence));
    object
        .entry("playbook_id".to_string())
        .or_insert_with(|| Value::String("default".to_string()));
    object
        .entry("playbook_name".to_string())
        .or_insert_with(|| Value::String("Default Playbook".to_string()));
    object
        .entry("playbook_type".to_string())
        .or_insert_with(|| Value::String("opposite_party".to_string()));
    object.insert(
        "playbook_type".to_string(),
        Value::String("opposite_party".to_string()),
    );
    object
        .entry("party_name".to_string())
        .or_insert_with(|| Value::String(default_party_name("opposite_party")));
    let normalized_law_type =
        normalize_law_type(object.get("law_type").and_then(Value::as_str), &law_type);
    object.insert("law_type".to_string(), Value::String(normalized_law_type));
    object
        .entry("original_clause_id".to_string())
        .or_insert_with(|| Value::String(original_clause_id));
    object
        .entry("clause_type".to_string())
        .or_insert_with(|| Value::String(clause_type));
    object
        .entry("history".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    object
        .entry("source_files".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));

    let meta = object
        .entry("meta".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if let Some(meta_object) = meta.as_object_mut() {
        meta_object
            .entry("version".to_string())
            .or_insert_with(|| Value::Number(1.into()));
        meta_object
            .entry("version_id".to_string())
            .or_insert_with(|| Value::String(fallback_version_id));
        meta_object
            .entry("review_status".to_string())
            .or_insert_with(|| Value::String("pending".to_string()));
        meta_object
            .entry("pending_evolve".to_string())
            .or_insert(Value::Bool(false));
        meta_object
            .entry("created_at".to_string())
            .or_insert_with(|| Value::String(created_at));
        meta_object
            .entry("created_by".to_string())
            .or_insert_with(|| Value::String(created_by));
        meta_object
            .entry("created_by_role".to_string())
            .or_insert_with(|| Value::String("lawyer".to_string()));
        meta_object
            .entry("created_from".to_string())
            .or_insert_with(|| Value::String("playbook_ingest".to_string()));
    }
}

fn clause_created_at(clause: &Value) -> Option<String> {
    clause
        .get("meta")
        .and_then(|meta| meta.get("created_at"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .or_else(|| {
            clause
                .get("created_at")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_owned)
        })
        .or_else(|| {
            clause
                .get("history")
                .and_then(Value::as_array)
                .and_then(|history| {
                    history.iter().find_map(|entry| {
                        entry
                            .get("timestamp")
                            .and_then(Value::as_str)
                            .filter(|value| !value.trim().is_empty())
                            .map(str::to_owned)
                    })
                })
        })
}

fn is_clause_low_confidence(clause: &Value) -> bool {
    fn non_empty_string(value: Option<&Value>) -> bool {
        value
            .and_then(Value::as_str)
            .is_some_and(|s| !s.trim().is_empty())
    }

    let positions = clause.get("positions");
    let has_positions = non_empty_string(positions.and_then(|p| p.get("preferred")))
        && non_empty_string(positions.and_then(|p| p.get("fallback_1")))
        && non_empty_string(positions.and_then(|p| p.get("fallback_2")));
    let has_required_strings = non_empty_string(clause.get("red_line"))
        && non_empty_string(clause.get("escalation_trigger"));
    let has_always_escalate = clause
        .get("always_escalate")
        .and_then(Value::as_bool)
        .is_some();
    let has_keywords = clause
        .get("keywords")
        .and_then(Value::as_array)
        .is_some_and(|values| !values.is_empty());

    !(has_positions && has_required_strings && has_always_escalate && has_keywords)
}

fn add_computed_status(clause: &mut Value) {
    let status = compute_clause_status(clause);
    if let Some(object) = clause.as_object_mut() {
        object.insert("status".to_string(), Value::String(status.to_string()));
    }
}

fn compute_clause_status(clause: &Value) -> &'static str {
    if clause
        .get("meta")
        .and_then(|meta| meta.get("review_status"))
        .and_then(Value::as_str)
        == Some("pending")
    {
        return "review pending";
    }
    if clause
        .get("meta")
        .and_then(|meta| meta.get("pending_evolve"))
        .and_then(Value::as_bool)
        == Some(true)
    {
        return "evolve suggestion";
    }
    if clause.get("always_escalate").and_then(Value::as_bool) == Some(true) {
        return "escalated";
    }
    "ok"
}

fn sort_clause_dashboard(a: &Value, b: &Value) -> std::cmp::Ordering {
    compare_clause_rule_number(a, b)
        .then_with(|| clause_label(a, "playbook_name").cmp(&clause_label(b, "playbook_name")))
        .then_with(|| clause_name(a).cmp(&clause_name(b)))
        .then_with(|| clause_label(a, "clause_id").cmp(&clause_label(b, "clause_id")))
}

fn sort_clause_review(a: &Value, b: &Value) -> std::cmp::Ordering {
    let rank = |clause: &Value| {
        let pending = clause
            .get("meta")
            .and_then(|meta| meta.get("review_status"))
            .and_then(Value::as_str)
            != Some("approved");
        let low = clause
            .get("low_confidence")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        match (pending, low) {
            (true, true) => 0,
            (true, false) => 1,
            (false, _) => 2,
        }
    };
    rank(a)
        .cmp(&rank(b))
        .then_with(|| compare_clause_rule_number(a, b))
        .then_with(|| clause_name(a).cmp(&clause_name(b)))
}

fn clause_name(clause: &Value) -> String {
    clause_label(clause, "name")
}

fn clause_label(clause: &Value, key: &str) -> String {
    clause
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn compare_clause_rule_number(a: &Value, b: &Value) -> std::cmp::Ordering {
    match (clause_rule_number_parts(a), clause_rule_number_parts(b)) {
        (Some(a_parts), Some(b_parts)) => compare_number_parts(&a_parts, &b_parts),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    }
}

fn clause_rule_number_parts(clause: &Value) -> Option<Vec<u64>> {
    let clause_id = clause.get("clause_id").and_then(Value::as_str);
    let clause_id_suffix = clause_id
        .and_then(|value| value.rsplit([':', '/']).next())
        .filter(|value| !value.trim().is_empty());

    for candidate in [
        clause.get("original_clause_id").and_then(Value::as_str),
        clause_id_suffix,
        clause_id,
        clause.get("name").and_then(Value::as_str),
        clause.get("clause_type").and_then(Value::as_str),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(parts) = extract_rule_number_parts(candidate) {
            return Some(parts);
        }
    }

    None
}

fn extract_rule_number_parts(value: &str) -> Option<Vec<u64>> {
    let mut digits = String::new();
    let mut started = false;

    for ch in value.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
            started = true;
            continue;
        }

        if started && matches!(ch, '.' | '_' | '-') {
            digits.push('.');
            continue;
        }

        if started {
            break;
        }
    }

    let parts = digits
        .trim_matches('.')
        .split('.')
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u64>().ok())
        .collect::<Vec<_>>();

    if parts.is_empty() { None } else { Some(parts) }
}

fn compare_number_parts(a: &[u64], b: &[u64]) -> std::cmp::Ordering {
    let max_len = a.len().max(b.len());
    for idx in 0..max_len {
        let ordering = a.get(idx).unwrap_or(&0).cmp(b.get(idx).unwrap_or(&0));
        if ordering != std::cmp::Ordering::Equal {
            return ordering;
        }
    }
    std::cmp::Ordering::Equal
}

fn deep_merge(target: &mut Value, patch: &Value) {
    match (target, patch) {
        (Value::Object(target_object), Value::Object(patch_object)) => {
            for (key, value) in patch_object {
                if key == "clause_id" {
                    continue;
                }
                match (target_object.get_mut(key), value) {
                    (Some(existing @ Value::Object(_)), Value::Object(_)) => {
                        deep_merge(existing, value);
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

fn generate_version_id(clause_id: &str, version: u64, action: &str) -> String {
    let now = Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_else(|| Utc::now().timestamp_micros() * 1_000);
    let seed = format!("{clause_id}:{version}:{action}:{now}");
    format!("VER-{:016x}", fnv1a_64(seed.as_bytes()))
}

fn stable_version_id(clause: &Value) -> String {
    let clause_id = clause
        .get("clause_id")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let seed = json!({
        "clause_id": clause_id,
        "version": meta_version(clause),
        "name": clause.get("name"),
        "positions": clause.get("positions"),
        "red_line": clause.get("red_line"),
        "escalation_trigger": clause.get("escalation_trigger"),
        "always_escalate": clause.get("always_escalate"),
        "keywords": clause.get("keywords"),
    });
    format!("VER-{:016x}", hash_json_fnv1a(&seed))
}

fn ensure_clause_version_id(clause: &mut Value) -> String {
    if let Some(existing) = meta_string(clause, "version_id") {
        return existing;
    }
    let version_id = stable_version_id(clause);
    set_meta_string(clause, "version_id", &version_id);
    version_id
}

fn assign_fresh_version_id(clause: &mut Value, action: &str) -> String {
    let previous = ensure_clause_version_id(clause);
    set_meta_string(clause, "previous_version_id", &previous);
    let clause_id = clause
        .get("clause_id")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let version_id = generate_version_id(clause_id, meta_version(clause), action);
    set_meta_string(clause, "version_id", &version_id);
    version_id
}

fn increment_meta_version(clause: &mut Value, action: &str) {
    let previous = ensure_clause_version_id(clause);
    let Some(object) = clause.as_object_mut() else {
        return;
    };
    let clause_id = object
        .get("clause_id")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let meta = object
        .entry("meta".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let Some(meta_object) = meta.as_object_mut() else {
        return;
    };
    let next = meta_object
        .get("version")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        + 1;
    meta_object.insert("version".to_string(), Value::Number(next.into()));
    meta_object.insert("previous_version_id".to_string(), Value::String(previous));
    meta_object.insert(
        "version_id".to_string(),
        Value::String(generate_version_id(&clause_id, next, action)),
    );
}

fn set_meta_number(clause: &mut Value, key: &str, value: u64) {
    let Some(object) = clause.as_object_mut() else {
        return;
    };
    let meta = object
        .entry("meta".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if let Some(meta_object) = meta.as_object_mut() {
        meta_object.insert(key.to_string(), Value::Number(value.into()));
    }
}

fn set_meta_string(clause: &mut Value, key: &str, value: &str) {
    let Some(object) = clause.as_object_mut() else {
        return;
    };
    let meta = object
        .entry("meta".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if let Some(meta_object) = meta.as_object_mut() {
        meta_object.insert(key.to_string(), Value::String(value.to_string()));
    }
}

fn append_clause_history_entry(clause: &mut Value, approved_by: &str, action: &str) {
    let version = meta_version(clause);
    let version_id = ensure_clause_version_id(clause);
    let previous_version_id = meta_string(clause, "previous_version_id");
    let snapshot = snapshot_clause_fields(clause);
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
        let history = object
            .entry("history".to_string())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(history_array) = history.as_array_mut() {
            history_array.push(entry);
        }
    }
}

fn snapshot_clause_fields(clause: &Value) -> Value {
    let mut snapshot = clause.clone();
    if let Some(object) = snapshot.as_object_mut() {
        object.remove("history");
        object.remove("status");
        object.remove("raw_source_segment");
    }
    snapshot
}

#[derive(Clone)]
struct VersionSnapshot {
    clause_id: String,
    clause_name: String,
    version: u64,
    version_id: String,
    previous_version_id: Option<String>,
    action: String,
    timestamp: Option<String>,
    snapshot: Value,
}

fn find_version_snapshot(clauses: &[Value], version_id: &str) -> Option<VersionSnapshot> {
    for clause in clauses {
        if meta_string(clause, "version_id").as_deref() == Some(version_id) {
            return Some(VersionSnapshot {
                clause_id: clause
                    .get("clause_id")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string(),
                clause_name: clause
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Unnamed clause")
                    .to_string(),
                version: meta_version(clause),
                version_id: version_id.to_string(),
                previous_version_id: meta_string(clause, "previous_version_id"),
                action: "current".to_string(),
                timestamp: meta_string(clause, "approved_at")
                    .or_else(|| meta_string(clause, "created_at")),
                snapshot: snapshot_clause_fields(clause),
            });
        }

        if let Some(history) = clause.get("history").and_then(Value::as_array) {
            for entry in history {
                let snapshot = entry
                    .get("fields_snapshot")
                    .cloned()
                    .unwrap_or_else(|| snapshot_clause_fields(clause));
                let entry_version_id = history_entry_version_id(clause, entry, &snapshot);
                if entry_version_id != version_id {
                    continue;
                }
                return Some(VersionSnapshot {
                    clause_id: snapshot
                        .get("clause_id")
                        .and_then(Value::as_str)
                        .or_else(|| clause.get("clause_id").and_then(Value::as_str))
                        .unwrap_or("unknown")
                        .to_string(),
                    clause_name: snapshot
                        .get("name")
                        .and_then(Value::as_str)
                        .or_else(|| clause.get("name").and_then(Value::as_str))
                        .unwrap_or("Unnamed clause")
                        .to_string(),
                    version: entry
                        .get("version")
                        .and_then(Value::as_u64)
                        .unwrap_or_else(|| meta_version(&snapshot)),
                    version_id: entry_version_id,
                    previous_version_id: entry
                        .get("previous_version_id")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                        .or_else(|| {
                            snapshot
                                .get("meta")
                                .and_then(|meta| meta.get("previous_version_id"))
                                .and_then(Value::as_str)
                                .map(str::to_owned)
                        }),
                    action: entry
                        .get("action")
                        .and_then(Value::as_str)
                        .unwrap_or("history")
                        .to_string(),
                    timestamp: entry
                        .get("timestamp")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    snapshot,
                });
            }
        }
    }
    None
}

fn history_entry_version_id(clause: &Value, entry: &Value, snapshot: &Value) -> String {
    if let Some(version_id) = entry.get("version_id").and_then(Value::as_str) {
        return version_id.to_string();
    }

    let snapshot_version = snapshot
        .get("meta")
        .and_then(|meta| meta.get("version"))
        .and_then(Value::as_u64);
    let entry_version = entry
        .get("version")
        .and_then(Value::as_u64)
        .unwrap_or_else(|| snapshot_version.unwrap_or_else(|| meta_version(snapshot)));
    let snapshot_version_id = snapshot
        .get("meta")
        .and_then(|meta| meta.get("version_id"))
        .and_then(Value::as_str);
    let current_version_id = meta_string(clause, "version_id");

    if let Some(version_id) = snapshot_version_id {
        if Some(version_id) != current_version_id.as_deref()
            && snapshot_version == Some(entry_version)
        {
            return version_id.to_string();
        }
    }

    synthetic_history_version_id(clause, entry_version)
}

fn synthetic_history_version_id(clause: &Value, version: u64) -> String {
    let clause_id = clause
        .get("clause_id")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    format!("{clause_id}:v{version}")
}

fn collect_version_diffs(from: &Value, to: &Value) -> Vec<VersionFieldDiff> {
    let fields = [
        ("Name", vec!["name"]),
        ("Preferred", vec!["positions", "preferred"]),
        ("Fallback 1", vec!["positions", "fallback_1"]),
        ("Fallback 2", vec!["positions", "fallback_2"]),
        ("Red line", vec!["red_line"]),
        ("Escalation trigger", vec!["escalation_trigger"]),
        ("Always escalate", vec!["always_escalate"]),
        ("Keywords", vec!["keywords"]),
    ];

    fields
        .into_iter()
        .filter_map(|(label, path)| {
            let from_value = value_at_path(from, &path);
            let to_value = value_at_path(to, &path);
            if from_value == to_value {
                return None;
            }
            Some(VersionFieldDiff {
                field: label.to_string(),
                from: format_compare_value(from_value),
                to: format_compare_value(to_value),
            })
        })
        .collect()
}

fn value_at_path<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

fn format_compare_value(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) if !value.trim().is_empty() => value.clone(),
        Some(Value::String(_)) | None | Some(Value::Null) => "Not set".to_string(),
        Some(Value::Bool(value)) => {
            if *value {
                "Yes".to_string()
            } else {
                "No".to_string()
            }
        }
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(", ")
            .if_empty("Not set"),
        Some(value) => value.to_string(),
    }
}

trait EmptyStringFallback {
    fn if_empty(self, fallback: &str) -> String;
}

impl EmptyStringFallback for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.trim().is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

fn normalize_compare_audience(audience: &str) -> &'static str {
    if audience.eq_ignore_ascii_case("lawyer") || audience.eq_ignore_ascii_case("legal") {
        "lawyer"
    } else {
        "business"
    }
}

fn build_version_explanation(
    from: &VersionSnapshot,
    to: &VersionSnapshot,
    changed_fields: &[VersionFieldDiff],
    audience: &str,
    question: Option<&str>,
) -> String {
    let audience = normalize_compare_audience(audience);
    if changed_fields.is_empty() {
        return format!(
            "{} v{} ({}) and v{} ({}) have no tracked field differences.",
            to.clause_name, from.version, from.version_id, to.version, to.version_id
        );
    }

    let field_summary = changed_fields
        .iter()
        .take(5)
        .map(|diff| {
            format!(
                "{} changed from `{}` to `{}`",
                diff.field, diff.from, diff.to
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    let question_context = question
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!(" User asked: {value}"))
        .unwrap_or_default();
    let previous_context = to
        .previous_version_id
        .as_deref()
        .map(|value| format!(" Previous version id: `{value}`."))
        .unwrap_or_default();

    if audience == "lawyer" {
        format!(
            "Legal version comparison for {}: v{} ({}) -> v{} ({}). {}. Review audit action `{}` and timestamp `{}` before relying on the newer wording.{}{}",
            to.clause_name,
            from.version,
            from.version_id,
            to.version,
            to.version_id,
            field_summary,
            to.action,
            to.timestamp.as_deref().unwrap_or("unknown"),
            previous_context,
            question_context
        )
    } else {
        format!(
            "Main difference for {}: v{} changed into v{}. {}. Use the newer version only after Legal has approved it.{}",
            to.clause_name, from.version, to.version, field_summary, question_context
        )
    }
}

pub fn extract_version_ids_from_text(text: &str) -> Vec<String> {
    let mut ids = Vec::new();
    for raw in text.split_whitespace() {
        let token = raw.trim_matches(|ch: char| {
            !ch.is_ascii_alphanumeric() && ch != '-' && ch != '_' && ch != ':'
        });
        let is_generated = token.len() == 20
            && token.starts_with("VER-")
            && token[4..].chars().all(|ch| ch.is_ascii_hexdigit());
        let is_demo_or_synthetic =
            token.contains(":v") && token.chars().any(|ch| ch.is_ascii_digit());
        if (is_generated || is_demo_or_synthetic) && !ids.iter().any(|id| id == token) {
            ids.push(token.to_string());
        }
    }
    ids
}

fn history_entry_in_range(entry: &Value, from: Option<&str>, to: Option<&str>) -> bool {
    let timestamp = entry.get("timestamp").and_then(Value::as_str).unwrap_or("");
    if let Some(from) = from {
        if timestamp < from {
            return false;
        }
    }
    if let Some(to) = to {
        if timestamp > to {
            return false;
        }
    }
    true
}

async fn read_raw_source_segments() -> Result<Value, (StatusCode, String)> {
    Ok(store::get_document("playbook/raw_source_segments")
        .await
        .map_err(internal_error)?
        .unwrap_or(Value::Object(Map::new())))
}

async fn merge_raw_source_segments(
    segments: Map<String, Value>,
) -> Result<(), (StatusCode, String)> {
    let mut current = match read_raw_source_segments().await? {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    for (key, value) in segments {
        current.insert(key, value);
    }
    store::put_document("playbook/raw_source_segments", &Value::Object(current))
        .await
        .map_err(internal_error)
}

async fn write_raw_source_segments(
    playbook: &Value,
    raw_text: &str,
) -> Result<(), (StatusCode, String)> {
    let mut segments = match read_raw_source_segments().await? {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    if let Some(clauses) = playbook.as_array() {
        for clause in clauses {
            if let Some(clause_id) = clause.get("clause_id").and_then(Value::as_str) {
                segments.insert(
                    clause_id.to_string(),
                    Value::String(extract_raw_segment_for_clause(clause, raw_text)),
                );
            }
        }
    }
    store::put_document("playbook/raw_source_segments", &Value::Object(segments))
        .await
        .map_err(internal_error)
}

fn extract_raw_segment_for_clause(clause: &Value, raw_text: &str) -> String {
    let name = clause.get("name").and_then(Value::as_str).unwrap_or("");
    if name.is_empty() {
        return raw_text.to_string();
    }
    let lower_raw = raw_text.to_ascii_lowercase();
    let lower_name = name.to_ascii_lowercase();
    if let Some(start) = lower_raw.find(&lower_name) {
        let end = (start + 2_000).min(raw_text.len());
        return raw_text[start..end].trim().to_string();
    }
    raw_text.to_string()
}

async fn read_playbook_or_null() -> Result<Value, (StatusCode, String)> {
    Ok(store::get_document("playbook/current")
        .await
        .map_err(internal_error)?
        .unwrap_or(Value::Null))
}

fn upload_draft_path(draft_id: &str) -> String {
    format!("playbook/upload_drafts/{draft_id}.json")
}

fn generate_upload_draft_id(playbook_id: &str) -> String {
    let now = Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_else(|| Utc::now().timestamp_micros() * 1_000);
    let seed = format!("{playbook_id}:draft:{now}");
    format!("DRAFT-{:016x}", fnv1a_64(seed.as_bytes()))
}

async fn write_upload_draft(draft_id: &str, draft: &Value) -> Result<(), (StatusCode, String)> {
    fs::create_dir_all("playbook/upload_drafts")
        .await
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to create upload draft directory: {err}"),
            )
        })?;
    fs::write(
        upload_draft_path(draft_id),
        serde_json::to_string_pretty(draft).map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to serialize upload draft: {err}"),
            )
        })?,
    )
    .await
    .map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to write upload draft: {err}"),
        )
    })
}

async fn read_upload_draft(draft_id: &str) -> Result<Value, (StatusCode, String)> {
    let content = fs::read_to_string(upload_draft_path(draft_id))
        .await
        .map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                (StatusCode::NOT_FOUND, "upload draft not found".to_string())
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to read upload draft: {err}"),
                )
            }
        })?;
    serde_json::from_str(&content).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("upload draft JSON is invalid: {err}"),
        )
    })
}

async fn read_playbook_versions() -> Result<Vec<Value>, (StatusCode, String)> {
    match store::get_document("playbook/versions")
        .await
        .map_err(internal_error)?
    {
        Some(Value::Array(versions)) => Ok(versions),
        Some(Value::Null) | None => Ok(Vec::new()),
        Some(_) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "stored playbook/versions must be an array".to_string(),
        )),
    }
}

async fn write_playbook_versions(versions: &[Value]) -> Result<(), (StatusCode, String)> {
    store::put_document("playbook/versions", &Value::Array(versions.to_vec()))
        .await
        .map_err(internal_error)
}

async fn persist_current_playbook(current: &Value, operation: &str) -> Result<(), (StatusCode, String)> {
    store::replace_playbook_documents(current, operation, None, None)
        .await
        .map_err(internal_error)
}

fn internal_error(message: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, message)
}

async fn record_playbook_version(
    current: &Value,
    playbook_id: &str,
    action: &str,
    bump_major: bool,
    changed_clause_ids: &[String],
) -> Result<Value, (StatusCode, String)> {
    let snapshot = playbook_snapshot(current, playbook_id);
    if snapshot.is_empty() {
        return Ok(Value::Null);
    }
    let mut versions = read_playbook_versions().await?;
    let (major, minor) = next_playbook_version_numbers(&versions, playbook_id, action, bump_major);
    let version_id = generate_playbook_version_id(playbook_id, major, minor, action);
    let entry = json!({
        "version_id": version_id,
        "playbook_id": playbook_id,
        "major": major,
        "minor": minor,
        "label": format!("v{major}.{minor}"),
        "action": action,
        "timestamp": Utc::now().to_rfc3339(),
        "changed_clause_ids": changed_clause_ids,
        "diff_summary": {
            "changed_clause_count": changed_clause_ids.len()
        },
        "snapshot": snapshot
    });
    versions.push(entry.clone());
    write_playbook_versions(&versions).await?;
    Ok(entry)
}

fn next_playbook_version_numbers(
    versions: &[Value],
    playbook_id: &str,
    action: &str,
    bump_major: bool,
) -> (u64, u64) {
    let latest = versions
        .iter()
        .filter(|entry| entry.get("playbook_id").and_then(Value::as_str) == Some(playbook_id))
        .max_by_key(|entry| {
            (
                entry.get("major").and_then(Value::as_u64).unwrap_or(0),
                entry.get("minor").and_then(Value::as_u64).unwrap_or(0),
            )
        });
    match latest {
        None if action == "create" => (1, 0),
        None if bump_major => (2, 0),
        None => (1, 1),
        Some(entry) if bump_major => (
            entry.get("major").and_then(Value::as_u64).unwrap_or(1) + 1,
            0,
        ),
        Some(entry) => (
            entry.get("major").and_then(Value::as_u64).unwrap_or(1),
            entry.get("minor").and_then(Value::as_u64).unwrap_or(0) + 1,
        ),
    }
}

fn generate_playbook_version_id(playbook_id: &str, major: u64, minor: u64, action: &str) -> String {
    let now = Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_else(|| Utc::now().timestamp_micros() * 1_000);
    let seed = format!("{playbook_id}:{major}.{minor}:{action}:{now}");
    format!("PBV-{:016x}", fnv1a_64(seed.as_bytes()))
}

fn playbook_snapshot(current: &Value, playbook_id: &str) -> Vec<Value> {
    current
        .as_array()
        .map(|clauses| {
            clauses
                .iter()
                .filter(|clause| {
                    clause.get("playbook_id").and_then(Value::as_str) == Some(playbook_id)
                })
                .map(snapshot_clause_fields)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

async fn playbook_versions_for(playbook_id: &str) -> Result<Vec<Value>, (StatusCode, String)> {
    let mut versions = read_playbook_versions()
        .await?
        .into_iter()
        .filter(|entry| entry.get("playbook_id").and_then(Value::as_str) == Some(playbook_id))
        .collect::<Vec<_>>();
    if versions.is_empty() {
        let current = read_playbook_or_null().await?;
        let snapshot = playbook_snapshot(&current, playbook_id);
        if snapshot.is_empty() {
            return Ok(Vec::new());
        }
        versions.push(json!({
            "version_id": format!("{}:v1.0", playbook_id),
            "playbook_id": playbook_id,
            "major": 1,
            "minor": 0,
            "label": "v1.0",
            "action": "current_seed",
            "timestamp": playbook_file_modified_at().await.unwrap_or_else(|| Utc::now().to_rfc3339()),
            "changed_clause_ids": [],
            "diff_summary": { "changed_clause_count": 0 },
            "snapshot": snapshot
        }));
    }
    versions.sort_by(|a, b| {
        let a_major = a.get("major").and_then(Value::as_u64).unwrap_or(0);
        let b_major = b.get("major").and_then(Value::as_u64).unwrap_or(0);
        let a_minor = a.get("minor").and_then(Value::as_u64).unwrap_or(0);
        let b_minor = b.get("minor").and_then(Value::as_u64).unwrap_or(0);
        b_major.cmp(&a_major).then_with(|| b_minor.cmp(&a_minor))
    });
    Ok(versions)
}

fn playbook_version_detail_diff(previous: Option<&Value>, current: &Value) -> Value {
    let changed_clause_ids = current
        .get("changed_clause_ids")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let current_snapshot = current
        .get("snapshot")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let previous_snapshot = previous
        .and_then(|entry| entry.get("snapshot"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let previous_by_id = previous_snapshot
        .iter()
        .filter_map(|clause| {
            clause
                .get("clause_id")
                .and_then(Value::as_str)
                .map(|id| (id.to_string(), clause.clone()))
        })
        .collect::<HashMap<_, _>>();

    let mut clause_diffs = Vec::new();
    for id in changed_clause_ids.iter().filter_map(Value::as_str) {
        let current_clause = current_snapshot
            .iter()
            .find(|clause| clause.get("clause_id").and_then(Value::as_str) == Some(id));
        let previous_clause = previous_by_id.get(id);
        if let Some(current_clause) = current_clause {
            let previous_value = previous_clause.cloned().unwrap_or(Value::Null);
            clause_diffs.push(json!({
                "clause_id": id,
                "name": current_clause.get("name").and_then(Value::as_str).unwrap_or("Unnamed clause"),
                "status": if previous_clause.is_some() { "updated" } else { "added" },
                "changed_fields": collect_version_diffs(&previous_value, current_clause)
            }));
        } else if let Some(previous_clause) = previous_clause {
            clause_diffs.push(json!({
                "clause_id": id,
                "name": previous_clause.get("name").and_then(Value::as_str).unwrap_or("Unnamed clause"),
                "status": "removed",
                "changed_fields": []
            }));
        }
    }
    Value::Array(clause_diffs)
}

async fn write_playbook_change_history(
    previous: &Value,
    current: &Value,
    operation: &str,
) -> Result<(), (StatusCode, String)> {
    let previous_hash = hash_json_fnv1a(previous);
    let current_hash = hash_json_fnv1a(current);
    if previous_hash == current_hash {
        return Ok(());
    }

    fs::create_dir_all(".playbook").await.map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to create .playbook directory: {err}"),
        )
    })?;

    let previous_path = format!(".playbook/{previous_hash:016x}.json");
    let current_path = format!(".playbook/{current_hash:016x}.json");
    let previous_hashed_path = format!(".playbook/{previous_hash:016x}.hashed.json");
    let current_hashed_path = format!(".playbook/{current_hash:016x}.hashed.json");

    let previous_serialized = serde_json::to_string_pretty(previous).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to serialize previous playbook history snapshot: {err}"),
        )
    })?;
    let current_serialized = serde_json::to_string_pretty(current).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to serialize current playbook history snapshot: {err}"),
        )
    })?;
    let previous_hashed_serialized = serde_json::to_string_pretty(&hash_json_values(previous))
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to serialize previous hashed playbook history snapshot: {err}"),
            )
        })?;
    let current_hashed_serialized = serde_json::to_string_pretty(&hash_json_values(current))
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to serialize current hashed playbook history snapshot: {err}"),
            )
        })?;

    fs::write(&previous_path, previous_serialized)
        .await
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to write old playbook history snapshot: {err}"),
            )
        })?;

    fs::write(&current_path, current_serialized)
        .await
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to write new playbook history snapshot: {err}"),
            )
        })?;
    fs::write(&previous_hashed_path, previous_hashed_serialized)
        .await
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to write old hashed playbook history snapshot: {err}"),
            )
        })?;
    fs::write(&current_hashed_path, current_hashed_serialized)
        .await
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to write new hashed playbook history snapshot: {err}"),
            )
        })?;

    fs::write(".playbook/CURRENT", format!("{current_hash:016x}\n"))
        .await
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to update .playbook/CURRENT: {err}"),
            )
        })?;

    let mut history_log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(".playbook/history.log")
        .await
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to open .playbook/history.log: {err}"),
            )
        })?;

    let timestamp = Utc::now().to_rfc3339();
    let line =
        format!("[{timestamp}] op={operation} from={previous_hash:016x} to={current_hash:016x}\n");
    history_log.write_all(line.as_bytes()).await.map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to write .playbook/history.log: {err}"),
        )
    })
}

fn clause_id_from_entry(entry: &Value) -> Result<&str, (StatusCode, String)> {
    entry
        .as_object()
        .ok_or((
            StatusCode::BAD_REQUEST,
            "patch array entries must be JSON objects".to_string(),
        ))?
        .get("clause_id")
        .and_then(Value::as_str)
        .ok_or((
            StatusCode::BAD_REQUEST,
            "patch array entries must include string field `clause_id`".to_string(),
        ))
}

fn build_clause_index_by_id(
    current_arr: &[Value],
) -> Result<HashMap<String, usize>, (StatusCode, String)> {
    let mut clause_index_by_id = HashMap::new();
    for (idx, entry) in current_arr.iter().enumerate() {
        let clause_id = clause_id_from_entry(entry)?;
        if clause_index_by_id
            .insert(clause_id.to_string(), idx)
            .is_some()
        {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("existing playbook has duplicate clause_id `{clause_id}`"),
            ));
        }
    }
    Ok(clause_index_by_id)
}

fn validate_upsert_array_structure(
    current_arr: &[Value],
    incoming_arr: &[Value],
    clause_index_by_id: &HashMap<String, usize>,
) -> Result<(), (StatusCode, String)> {
    let mut seen_incoming_ids = HashSet::new();
    let template = current_arr.first();

    for (idx, entry) in incoming_arr.iter().enumerate() {
        let clause_id = clause_id_from_entry(entry)?;
        if !seen_incoming_ids.insert(clause_id.to_string()) {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("duplicate clause_id `{clause_id}` in patch payload"),
            ));
        }

        let reference = clause_index_by_id
            .get(clause_id)
            .and_then(|existing_idx| current_arr.get(*existing_idx))
            .or(template);
        if let Some(reference) = reference {
            if !json_structure_matches(reference, entry) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!(
                        "patch array entry at index {idx} does not match existing playbook entry structure"
                    ),
                ));
            }
        }
    }

    Ok(())
}

fn json_structure_matches(reference: &Value, candidate: &Value) -> bool {
    match (reference, candidate) {
        (Value::Object(ref_obj), Value::Object(cand_obj)) => {
            if ref_obj.len() != cand_obj.len() {
                return false;
            }
            ref_obj.iter().all(|(key, ref_value)| {
                cand_obj
                    .get(key)
                    .is_some_and(|cand_value| json_structure_matches(ref_value, cand_value))
            })
        }
        (Value::Array(ref_arr), Value::Array(cand_arr)) => {
            if ref_arr.is_empty() || cand_arr.is_empty() {
                return true;
            }

            let reference_item = &ref_arr[0];
            cand_arr
                .iter()
                .all(|item| json_structure_matches(reference_item, item))
        }
        (Value::String(_), Value::String(_))
        | (Value::Number(_), Value::Number(_))
        | (Value::Bool(_), Value::Bool(_))
        | (Value::Null, Value::Null) => true,
        _ => false,
    }
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

fn hash_json_values(value: &Value) -> Value {
    hash_json_values_for_key(value, None)
}

fn hash_json_values_for_key(value: &Value, current_key: Option<&str>) -> Value {
    if current_key == Some("clause_id") {
        return value.clone();
    }

    if current_key == Some("keywords")
        || current_key == Some("meta")
        || current_key == Some("name")
        || current_key == Some("always_escalate")
    {
        let bytes = serde_json::to_vec(value).unwrap_or_default();
        return Value::String(format!("{:016x}", fnv1a_64(&bytes)));
    }

    match value {
        Value::Object(map) => {
            let mut output = serde_json::Map::new();
            for (key, nested) in map {
                output.insert(key.clone(), hash_json_values_for_key(nested, Some(key)));
            }
            Value::Object(output)
        }
        Value::Array(values) => Value::Array(
            values
                .iter()
                .map(|nested| hash_json_values_for_key(nested, None))
                .collect(),
        ),
        scalar => {
            let bytes = serde_json::to_vec(scalar).unwrap_or_default();
            Value::String(format!("{:016x}", fnv1a_64(&bytes)))
        }
    }
}

async fn build_playbook_json_with_openai(
    cleaned_text: &str,
) -> Result<Value, (StatusCode, String)> {
    let api_key = std::env::var("OPENAI_API_KEY").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "OPENAI_API_KEY is not configured".to_string(),
        )
    })?;

    let schema_template = json!({
      "clause_id": "<string>",
      "name": "<string>",
      "positions": {
        "preferred": "<string>",
        "fallback_1": "<string>",
        "fallback_2": "<string>"
      },
      "red_line": "<string>",
      "escalation_trigger": "<string>",
      "always_escalate": true,
      "keywords": ["<string>"],
      "negotiation_history": [
        {
          "contract_id": "<string>",
          "outcome": "<string>",
          "jurisdiction": "<string>",
          "amount": "<string>",
          "escalated": false,
          "date": "<YYYY-MM-DD>"
        }
      ],
      "meta": {
        "version": 1,
        "approved_by": "<string>",
        "pending_evolve": true
      }
    });

    let prompt = format!(
        "Extract a structured legal playbook from the text.\n\
         Return JSON only (no markdown).\n\
         IMPORTANT:\n\
         - The template below is schema-only (keys/types), not content.\n\
         - Do NOT copy or paraphrase placeholder/template values.\n\
         - Populate rich, detailed values strictly from the provided text.\n\
         - If multiple clauses/topics exist, return a JSON ARRAY of objects.\n\
         - If only one clause/topic exists, return an ARRAY with one object.\n\
         - Keep key names and value types compatible with this schema:\n{}\n\n\
         PLAYBOOK TEXT:\n{}",
        serde_json::to_string_pretty(&schema_template).unwrap_or_default(),
        cleaned_text
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

    let response_json: Value = response.json().await.map_err(|err| {
        (
            StatusCode::BAD_GATEWAY,
            format!("failed to decode OpenAI response: {err}"),
        )
    })?;
    let output_text = extract_output_text(&response_json).ok_or((
        StatusCode::BAD_GATEWAY,
        "OpenAI response did not contain text output".to_string(),
    ))?;

    let output_text = strip_markdown_fence(&output_text);
    let parsed: Value = serde_json::from_str(&output_text).map_err(|err| {
        (
            StatusCode::BAD_GATEWAY,
            format!("OpenAI output was not valid JSON: {err}"),
        )
    })?;

    if !(parsed.is_object() || parsed.is_array()) {
        return Err((
            StatusCode::BAD_GATEWAY,
            "OpenAI output JSON must be an object or array".to_string(),
        ));
    }

    Ok(parsed)
}

fn extract_output_text(response_json: &Value) -> Option<String> {
    //TODO: Potential change to response_json["output"]["content"]...
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
    let canonical = canonicalize_json(value);
    let serialized = serde_json::to_vec(&canonical).unwrap_or_default();
    fnv1a_64(&serialized)
}

fn canonicalize_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut ordered = BTreeMap::new();
            for (k, v) in map {
                ordered.insert(k.clone(), canonicalize_json(v));
            }
            let mut output = serde_json::Map::new();
            for (k, v) in ordered {
                output.insert(k, v);
            }
            Value::Object(output)
        }
        Value::Array(values) => Value::Array(values.iter().map(canonicalize_json).collect()),
        _ => value.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn complete_clause() -> Value {
        json!({
            "clause_id": "C01",
            "name": "Liability",
            "positions": {
                "preferred": "100% cap",
                "fallback_1": "150% cap",
                "fallback_2": "200% cap"
            },
            "red_line": "No uncapped liability",
            "escalation_trigger": "unlimited liability",
            "always_escalate": false,
            "keywords": ["liability"],
            "negotiation_history": [],
            "meta": { "version": 1, "review_status": "pending", "pending_evolve": false }
        })
    }

    #[test]
    fn normalize_clause_adds_review_history_and_confidence_fields() {
        let mut clause = complete_clause();
        normalize_clause(&mut clause);

        assert_eq!(clause["low_confidence"], Value::Bool(false));
        assert_eq!(clause["history"], Value::Array(Vec::new()));
        assert_eq!(
            clause["meta"]["review_status"],
            Value::String("pending".to_string())
        );
        assert_eq!(
            clause["meta"]["created_by"],
            Value::String("Legal Counsel".to_string())
        );
        assert_eq!(
            clause["meta"]["created_from"],
            Value::String("playbook_ingest".to_string())
        );
    }

    #[test]
    fn normalize_clause_backfills_audit_metadata_from_existing_values() {
        let mut clause = complete_clause();
        clause["meta"]["approved_by"] = Value::String("Senior Legal".to_string());
        clause["history"] = Value::Array(vec![json!({
            "timestamp": "2026-04-25T20:00:00Z",
            "approved_by": "Senior Legal"
        })]);

        normalize_clause_with_created_at(&mut clause, Some("2026-04-24T20:00:00Z"));

        assert_eq!(
            clause["meta"]["created_at"],
            Value::String("2026-04-25T20:00:00Z".to_string())
        );
        assert_eq!(
            clause["meta"]["created_by"],
            Value::String("Senior Legal".to_string())
        );
        assert_eq!(clause["source_files"], Value::Array(Vec::new()));
    }

    #[test]
    fn stamp_uploaded_playbook_preserves_source_metadata() {
        let mut playbook = Value::Array(vec![complete_clause()]);
        let mut existing_ids = HashSet::new();
        let uploader = UploaderContext {
            role: UploaderRole::Lawyer,
            name: "Legal Counsel".to_string(),
            email: Some("legal.counsel@livebook.com".to_string()),
        };

        stamp_uploaded_playbook(
            &mut playbook,
            "globex-playbook",
            "Globex Playbook",
            "opposite_party",
            "Globex GmbH",
            "General Commercial",
            "2026-04-25T21:00:00Z",
            &["Globex NDA.pdf".to_string()],
            &uploader,
            &mut existing_ids,
        );

        let clause = &playbook[0];
        assert_eq!(
            clause["playbook_name"],
            Value::String("Globex Playbook".to_string())
        );
        assert_eq!(
            clause["source_files"],
            Value::Array(vec![Value::String("Globex NDA.pdf".to_string())])
        );
        assert_eq!(
            clause["meta"]["created_at"],
            Value::String("2026-04-25T21:00:00Z".to_string())
        );
        assert_eq!(
            clause["meta"]["created_from"],
            Value::String("playbook_ingest".to_string())
        );
    }

    #[test]
    fn business_upload_stamp_marks_clause_pending_for_lawyer_review() {
        let mut playbook = Value::Array(vec![complete_clause()]);
        let mut existing_ids = HashSet::new();
        let uploader = UploaderContext {
            role: UploaderRole::Business,
            name: "Procurement Lead".to_string(),
            email: Some("procurement@livebook.com".to_string()),
        };

        stamp_uploaded_playbook(
            &mut playbook,
            "business-playbook",
            "Business Playbook",
            "opposite_party",
            "Globex GmbH",
            "General Commercial",
            "2026-04-25T21:00:00Z",
            &["Business Playbook.docx".to_string()],
            &uploader,
            &mut existing_ids,
        );

        let clause = &playbook[0];
        assert_eq!(
            clause["meta"]["review_status"],
            Value::String("pending".to_string())
        );
        assert_eq!(
            clause["meta"]["created_by_role"],
            Value::String("business".to_string())
        );
        assert_eq!(clause["meta"].get("approved_by"), None);
        assert!(
            clause["meta"]["version_id"]
                .as_str()
                .unwrap_or_default()
                .starts_with("VER-")
        );
    }

    #[test]
    fn lawyer_upload_stamp_marks_clause_approved_without_review_queue_item() {
        let mut playbook = Value::Array(vec![complete_clause()]);
        let mut existing_ids = HashSet::new();
        let uploader = UploaderContext {
            role: UploaderRole::Lawyer,
            name: "Senior Legal".to_string(),
            email: None,
        };

        stamp_uploaded_playbook(
            &mut playbook,
            "legal-playbook",
            "Legal Playbook",
            "opposite_party",
            "Globex GmbH",
            "General Commercial",
            "2026-04-25T21:00:00Z",
            &["Legal Playbook.pdf".to_string()],
            &uploader,
            &mut existing_ids,
        );

        let clause = &playbook[0];
        assert_eq!(
            clause["meta"]["review_status"],
            Value::String("approved".to_string())
        );
        assert_eq!(
            clause["meta"]["created_by_role"],
            Value::String("lawyer".to_string())
        );
        assert_eq!(
            clause["meta"]["approved_by"],
            Value::String("Senior Legal".to_string())
        );
    }

    #[test]
    fn missing_required_field_sets_low_confidence() {
        let mut clause = complete_clause();
        clause.as_object_mut().unwrap().remove("red_line");
        normalize_clause(&mut clause);

        assert_eq!(clause["low_confidence"], Value::Bool(true));
    }

    #[test]
    fn review_sort_prioritizes_low_confidence_pending() {
        let mut low = complete_clause();
        low["name"] = Value::String("B".to_string());
        low["original_clause_id"] = Value::String("3".to_string());
        low["low_confidence"] = Value::Bool(true);
        let mut approved = complete_clause();
        approved["name"] = Value::String("A".to_string());
        approved["original_clause_id"] = Value::String("1".to_string());
        approved["meta"]["review_status"] = Value::String("approved".to_string());
        let mut pending = complete_clause();
        pending["name"] = Value::String("C".to_string());
        pending["original_clause_id"] = Value::String("2".to_string());
        pending["low_confidence"] = Value::Bool(false);

        let mut clauses = vec![approved, pending, low];
        clauses.sort_by(sort_clause_review);

        assert_eq!(clauses[0]["name"], Value::String("B".to_string()));
        assert_eq!(clauses[1]["name"], Value::String("C".to_string()));
        assert_eq!(clauses[2]["name"], Value::String("A".to_string()));
    }

    #[test]
    fn dashboard_sort_orders_clauses_by_rule_number() {
        let mut rule_two = complete_clause();
        rule_two["name"] = Value::String("Rule two".to_string());
        rule_two["original_clause_id"] = Value::String("2".to_string());

        let mut rule_ten = complete_clause();
        rule_ten["name"] = Value::String("Rule ten".to_string());
        rule_ten["original_clause_id"] = Value::String("10".to_string());

        let mut rule_one_two = complete_clause();
        rule_one_two["name"] = Value::String("Rule one two".to_string());
        rule_one_two["original_clause_id"] = Value::String("1.2".to_string());

        let mut clauses = vec![rule_ten, rule_two, rule_one_two];
        clauses.sort_by(sort_clause_dashboard);

        assert_eq!(
            clauses[0]["name"],
            Value::String("Rule one two".to_string())
        );
        assert_eq!(clauses[1]["name"], Value::String("Rule two".to_string()));
        assert_eq!(clauses[2]["name"], Value::String("Rule ten".to_string()));
    }

    #[test]
    fn rule_number_falls_back_to_clause_id_suffix() {
        let mut rule_two = complete_clause();
        rule_two["name"] = Value::String("Rule two".to_string());
        rule_two["clause_id"] = Value::String("playbook-20260425T230235312:2".to_string());
        rule_two
            .as_object_mut()
            .unwrap()
            .remove("original_clause_id");

        let mut rule_ten = complete_clause();
        rule_ten["name"] = Value::String("Rule ten".to_string());
        rule_ten["clause_id"] = Value::String("playbook-20260425T230235312:10".to_string());
        rule_ten
            .as_object_mut()
            .unwrap()
            .remove("original_clause_id");

        let mut clauses = vec![rule_ten, rule_two];
        clauses.sort_by(sort_clause_dashboard);

        assert_eq!(clauses[0]["name"], Value::String("Rule two".to_string()));
        assert_eq!(clauses[1]["name"], Value::String("Rule ten".to_string()));
    }

    #[test]
    fn approval_history_snapshots_prior_clause_fields() {
        let mut clause = complete_clause();
        append_clause_history_entry(&mut clause, "Ada", "edit");

        let history = clause["history"].as_array().unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0]["approved_by"], Value::String("Ada".to_string()));
        assert_eq!(
            history[0]["fields_snapshot"]["red_line"],
            Value::String("No uncapped liability".to_string())
        );
    }

    #[test]
    fn partial_merge_updates_nested_fields_without_replacing_siblings() {
        let mut clause = complete_clause();
        deep_merge(
            &mut clause,
            &json!({ "positions": { "preferred": "50% cap" }}),
        );

        assert_eq!(
            clause["positions"]["preferred"],
            Value::String("50% cap".to_string())
        );
        assert_eq!(
            clause["positions"]["fallback_1"],
            Value::String("150% cap".to_string())
        );
    }

    #[test]
    fn version_transition_assigns_unique_visible_version_id() {
        let mut clause = complete_clause();
        let first_id = ensure_clause_version_id(&mut clause);

        increment_meta_version(&mut clause, "edit");
        let second_id = meta_string(&clause, "version_id").unwrap();

        assert_ne!(first_id, second_id);
        assert!(second_id.starts_with("VER-"));
        assert_eq!(
            clause["meta"]["previous_version_id"],
            Value::String(first_id)
        );
    }

    #[test]
    fn restore_version_id_links_to_restored_source() {
        let mut clause = complete_clause();
        let restored_from = ensure_clause_version_id(&mut clause);

        increment_meta_version(&mut clause, "restore");
        set_meta_string(&mut clause, "restored_from_version_id", &restored_from);

        assert_eq!(
            clause["meta"]["restored_from_version_id"],
            Value::String(restored_from.clone())
        );
        assert_ne!(
            clause["meta"]["version_id"].as_str().unwrap_or_default(),
            restored_from
        );
    }

    #[test]
    fn version_id_extraction_finds_two_unique_ids_in_question_text() {
        let ids = extract_version_ids_from_text(
            "Explain difference between VER-aaaaaaaaaaaaaaaa and VER-bbbbbbbbbbbbbbbb.",
        );

        assert_eq!(
            ids,
            vec![
                "VER-aaaaaaaaaaaaaaaa".to_string(),
                "VER-bbbbbbbbbbbbbbbb".to_string()
            ]
        );
    }

    #[test]
    fn history_entry_uses_synthetic_id_when_snapshot_repeats_current_id() {
        let clause = json!({
            "clause_id": "globex-gmbh-playbook:NDA-08",
            "name": "Other Liabilities",
            "meta": { "version": 3, "version_id": "globex-gmbh-playbook:NDA-08:v3:demo" }
        });
        let entry = json!({
            "version": 2,
            "fields_snapshot": {
                "clause_id": "globex-gmbh-playbook:NDA-08",
                "name": "Other Liabilities",
                "meta": { "version": 2, "version_id": "globex-gmbh-playbook:NDA-08:v3:demo" }
            }
        });

        let snapshot = entry.get("fields_snapshot").unwrap();

        assert_eq!(
            history_entry_version_id(&clause, &entry, snapshot),
            "globex-gmbh-playbook:NDA-08:v2".to_string()
        );
    }

    #[test]
    fn version_id_extraction_supports_demo_colon_ids() {
        let ids = extract_version_ids_from_text(
            "Explain globex-gmbh-playbook:NDA-08:v2 and globex-gmbh-playbook:NDA-08:v3:demo",
        );

        assert_eq!(
            ids,
            vec![
                "globex-gmbh-playbook:NDA-08:v2".to_string(),
                "globex-gmbh-playbook:NDA-08:v3:demo".to_string()
            ]
        );
    }

    #[test]
    fn rust_pdf_fallback_extracts_text_without_pdftotext_binary() {
        let fixture_path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/playbook.pdf");
        let Ok(pdf_bytes) = std::fs::read(fixture_path) else {
            return;
        };
        let extracted = extract_pdf_text_from_bytes(&pdf_bytes).expect("PDF text fallback works");

        assert!(extracted.len() > 100);
    }
}
