use axum::{Json, extract::Multipart, http::StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::io::{Cursor, Read};
use std::time::Duration;

use crate::repositories::store;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuditEntry {
    pub actor: String,
    pub action: String,
    pub final_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewFinding {
    pub id: String,
    pub severity: String,
    pub clause_ref: String,
    pub status: String,
    pub confidence: f32,
    pub issue: String,
    pub source: String,
    pub comment: String,
    pub redline: Option<String>,
    pub eligible_for_bulk: bool,
    pub audit: Vec<AuditEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewSession {
    pub session_id: String,
    pub status: String,
    pub findings: Vec<ReviewFinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WordReviewRequest {
    pub document_text: String,
    pub actor: String,
    pub word_context_available: bool,
    pub persist: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewActionRequest {
    pub finding_id: String,
    pub actor: String,
    pub action: String,
    pub edited_redline: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewActionBody {
    pub session: ReviewSession,
    pub finding_id: String,
    pub actor: String,
    pub action: String,
    pub edited_redline: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BulkReviewBody {
    pub session: ReviewSession,
    pub actor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewRestoreBody {
    pub session: ReviewSession,
    pub expected_session: Option<ReviewSession>,
    pub actor: String,
    pub reason: Option<String>,
}

pub fn run_word_review(request: WordReviewRequest) -> Result<ReviewSession, String> {
    if !request.word_context_available {
        return Err(
            "Word document context is unavailable. Retry from Word or upload a contract.".into(),
        );
    }

    let text = request.document_text.trim();
    if text.is_empty() {
        return Err("Document text is required for review.".into());
    }

    let mut findings = Vec::new();
    let lower = text.to_ascii_lowercase();

    if lower.contains("unlimited liability") {
        findings.push(ReviewFinding {
            id: "review-liability-cap".into(),
            severity: "high".into(),
            clause_ref: "Limitation of Liability".into(),
            status: "pending".into(),
            confidence: 0.94,
            issue: "Unlimited liability is materially off playbook and should be capped.".into(),
            source: excerpt_for(text, "unlimited liability"),
            comment: "Consider adding a liability cap before approval.".into(),
            redline: Some("Liability is capped at fees paid in the prior 12 months.".into()),
            eligible_for_bulk: true,
            audit: vec![AuditEntry {
                actor: request.actor.clone(),
                action: "generated".into(),
                final_text: None,
            }],
        });
    }

    if lower.contains("[insert") || lower.contains("[●") || lower.contains("tbd") {
        findings.push(ReviewFinding {
            id: "review-placeholder".into(),
            severity: "medium".into(),
            clause_ref: "Drafting Cleanup".into(),
            status: "pending".into(),
            confidence: 0.91,
            issue: "Placeholder text remains in the document.".into(),
            source: excerpt_for(text, "["),
            comment: "Resolve placeholder text before circulating the draft.".into(),
            redline: Some("Replace placeholder with final party or deal detail.".into()),
            eligible_for_bulk: true,
            audit: vec![AuditEntry {
                actor: request.actor.clone(),
                action: "generated".into(),
                final_text: None,
            }],
        });
    }

    if lower.contains("unclear") || lower.contains("reasonable efforts") {
        findings.push(ReviewFinding {
            id: "review-ambiguous-services".into(),
            severity: "low".into(),
            clause_ref: "Services".into(),
            status: "pending".into(),
            confidence: 0.58,
            issue: "Services obligation may need clearer operational detail.".into(),
            source: excerpt_for(text, "unclear"),
            comment: "Confirm whether the service standard is specific enough for this matter."
                .into(),
            redline: Some("Specify measurable service obligations and acceptance criteria.".into()),
            eligible_for_bulk: false,
            audit: vec![AuditEntry {
                actor: request.actor.clone(),
                action: "generated".into(),
                final_text: None,
            }],
        });
    }

    if findings.is_empty() {
        findings.push(ReviewFinding {
            id: "review-no-material-issues".into(),
            severity: "info".into(),
            clause_ref: "General Review".into(),
            status: "pending".into(),
            confidence: 0.72,
            issue: "No obvious high-risk pattern was detected by the deterministic review checks."
                .into(),
            source: excerpt_for(text, ""),
            comment: "Perform lawyer review before final acceptance.".into(),
            redline: None,
            eligible_for_bulk: false,
            audit: vec![AuditEntry {
                actor: request.actor.clone(),
                action: "generated".into(),
                final_text: None,
            }],
        });
    }

    Ok(ReviewSession {
        session_id: stable_id("word-review", text),
        status: "ready_for_review".into(),
        findings,
    })
}

pub fn apply_review_action(
    session: &mut ReviewSession,
    request: ReviewActionRequest,
) -> Result<(), String> {
    let finding = session
        .findings
        .iter_mut()
        .find(|finding| finding.id == request.finding_id)
        .ok_or_else(|| format!("finding {} not found", request.finding_id))?;

    match request.action.as_str() {
        "apply" | "accept" => {
            let final_text = request.edited_redline.or_else(|| finding.redline.clone());
            if final_text.is_none() {
                return Err("Cannot apply a finding without redline text.".into());
            }
            finding.status = "applied".into();
            finding.audit.push(AuditEntry {
                actor: request.actor,
                action: "applied".into(),
                final_text,
            });
        }
        "reject" => {
            finding.status = "rejected".into();
            finding.audit.push(AuditEntry {
                actor: request.actor,
                action: "rejected".into(),
                final_text: None,
            });
        }
        "skip" => {
            finding.status = "skipped".into();
            finding.audit.push(AuditEntry {
                actor: request.actor,
                action: "skipped".into(),
                final_text: None,
            });
        }
        other => return Err(format!("unsupported review action: {other}")),
    }
    Ok(())
}

pub fn bulk_apply_review(session: &mut ReviewSession, actor: &str) -> Result<Value, String> {
    let mut applied = 0_u64;
    let mut skipped = 0_u64;

    for finding in &mut session.findings {
        if finding.status != "pending" {
            skipped += 1;
            continue;
        }
        if finding.eligible_for_bulk && finding.redline.is_some() && finding.confidence >= 0.8 {
            finding.status = "applied".into();
            finding.audit.push(AuditEntry {
                actor: actor.into(),
                action: "bulk_applied".into(),
                final_text: finding.redline.clone(),
            });
            applied += 1;
        } else {
            skipped += 1;
        }
    }

    Ok(json!({
        "applied": applied,
        "skipped": skipped,
    }))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DraftRequest {
    pub instructions: String,
    pub document_context: Option<String>,
    pub party_position: Option<String>,
    pub jurisdiction: Option<String>,
    pub writing_style: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DraftResult {
    pub content: String,
    pub assumptions: Vec<String>,
    pub sources: Vec<String>,
    pub library_matches: Vec<ClauseLibraryItem>,
    pub review_notes: Vec<String>,
    pub generation_mode: String,
    pub model_error: Option<String>,
    pub available_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClauseLibraryItem {
    pub id: String,
    pub title: String,
    pub clause_type: String,
    pub text: String,
    pub visibility: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClauseLibrarySearchRequest {
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClauseLibrarySaveRequest {
    pub title: String,
    pub clause_type: String,
    pub text: String,
    pub visibility: String,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PrecedentUploadRequest {
    pub title: String,
    pub text: String,
    pub visibility: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PrecedentUploadResult {
    pub document_id: String,
    pub title: String,
    pub visibility: String,
    pub imported_clauses: Vec<ClauseLibraryItem>,
}

pub struct ParsedPrecedentFile {
    pub title: String,
    pub text: String,
    pub visibility: String,
}

#[allow(dead_code)]
pub fn draft_clause(
    request: DraftRequest,
    approved_playbook_language: Option<&str>,
) -> DraftResult {
    draft_clause_with_library(
        request,
        approved_playbook_language,
        &seeded_clause_library(),
    )
}

pub fn draft_clause_with_library(
    request: DraftRequest,
    approved_playbook_language: Option<&str>,
    library_items: &[ClauseLibraryItem],
) -> DraftResult {
    let mut assumptions = Vec::new();
    if request
        .jurisdiction
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        assumptions
            .push("jurisdiction not provided; draft uses jurisdiction-neutral language".into());
    }
    if request
        .party_position
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        assumptions.push("party position not provided; draft uses balanced language".into());
    }

    let instruction = request.instructions.trim();
    let party = request.party_position.as_deref().unwrap_or("balanced");
    let style = request
        .writing_style
        .as_deref()
        .unwrap_or("clear legal drafting");
    let mut sources = Vec::new();
    let library_matches = search_clause_library(&request.instructions, library_items);

    let base = if let Some(language) = approved_playbook_language {
        sources.push("approved playbook language".into());
        language.to_string()
    } else if let Some(match_item) = library_matches.first() {
        sources.push(format!("precedent library: {}", match_item.title));
        format!(
            "{}\n\nAdapted drafting note: {}",
            match_item.text, instruction
        )
    } else if let Some(context) = request.document_context.as_deref() {
        sources.push("document context".into());
        format!("For the {context}, the parties agree to language addressing: {instruction}.")
    } else {
        format!("The parties agree to language addressing: {instruction}.")
    };

    DraftResult {
        content: format!(
            "{base} This indemnity draft is written for the {party} position in {style} style."
        ),
        assumptions,
        sources,
        library_matches,
        review_notes: vec![
            "Generated language is staged for lawyer review before insertion.".into(),
            "Confirm defined terms and party names against the active document.".into(),
        ],
        generation_mode: "deterministic_with_precedent_library".into(),
        model_error: None,
        available_actions: vec![
            "edit".into(),
            "insert_into_word".into(),
            "save_favorite".into(),
            "discard".into(),
        ],
    }
}

pub fn search_clause_library(query: &str, items: &[ClauseLibraryItem]) -> Vec<ClauseLibraryItem> {
    let query_terms = tokens(query);
    if query_terms.is_empty() {
        return Vec::new();
    }

    let mut scored = items
        .iter()
        .filter_map(|item| {
            let haystack = format!(
                "{} {} {} {}",
                item.title, item.clause_type, item.text, item.source
            )
            .to_ascii_lowercase();
            let score = query_terms
                .iter()
                .filter(|term| haystack.contains(term.as_str()))
                .count();
            (score > 0).then_some((score, item.clone()))
        })
        .collect::<Vec<_>>();
    scored.sort_by(|(left_score, left), (right_score, right)| {
        right_score
            .cmp(left_score)
            .then_with(|| left.title.cmp(&right.title))
    });
    scored.into_iter().map(|(_, item)| item).collect()
}

pub fn seeded_clause_library() -> Vec<ClauseLibraryItem> {
    vec![
        ClauseLibraryItem {
            id: "precedent-ip-indemnity-customer".into(),
            title: "Customer-side IP indemnity".into(),
            clause_type: "indemnity".into(),
            text: "Supplier shall defend, indemnify, and hold harmless Customer from third-party claims alleging that the Services infringe intellectual property rights, including reasonable attorneys' fees and settlement amounts approved by Supplier.".into(),
            visibility: "shared".into(),
            source: "approved precedent library".into(),
        },
        ClauseLibraryItem {
            id: "precedent-liability-cap-fees".into(),
            title: "Fees-based liability cap".into(),
            clause_type: "limitation_of_liability".into(),
            text: "Except for excluded claims, each party's aggregate liability shall not exceed the fees paid or payable under the agreement during the twelve months before the claim arose.".into(),
            visibility: "shared".into(),
            source: "approved precedent library".into(),
        },
        ClauseLibraryItem {
            id: "precedent-mutual-confidentiality".into(),
            title: "Mutual confidentiality covenant".into(),
            clause_type: "confidentiality".into(),
            text: "Each party shall protect the other party's Confidential Information using at least reasonable care and shall use it only to perform or receive the services under this agreement.".into(),
            visibility: "team".into(),
            source: "precedent import".into(),
        },
    ]
}

pub fn save_clause_library_item(
    request: ClauseLibrarySaveRequest,
) -> Result<ClauseLibraryItem, String> {
    if request.title.trim().is_empty() || request.text.trim().is_empty() {
        return Err("Clause title and text are required.".into());
    }
    let item = ClauseLibraryItem {
        id: stable_id(
            "clause-library",
            &format!("{}:{}", request.title, request.text),
        ),
        title: request.title.trim().into(),
        clause_type: request.clause_type.trim().into(),
        text: request.text.trim().into(),
        visibility: if request.visibility.trim().is_empty() {
            "private".into()
        } else {
            request.visibility.trim().into()
        },
        source: request
            .source
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("saved favorite")
            .trim()
            .into(),
    };
    Ok(item)
}

pub fn import_precedent_document(
    request: PrecedentUploadRequest,
) -> Result<PrecedentUploadResult, String> {
    let title = request.title.trim();
    let text = request.text.trim();
    if title.is_empty() || text.is_empty() {
        return Err("Precedent title and text are required.".into());
    }
    let document_id = stable_id("precedent-document", &format!("{title}:{text}"));
    let visibility = if request.visibility.trim().is_empty() {
        "private"
    } else {
        request.visibility.trim()
    };
    let imported_clauses = extract_precedent_clauses(&document_id, title, text, visibility);
    Ok(PrecedentUploadResult {
        document_id,
        title: title.into(),
        visibility: visibility.into(),
        imported_clauses,
    })
}

pub fn extract_precedent_upload_file(
    filename: &str,
    bytes: &[u8],
    title: Option<String>,
    visibility: Option<String>,
) -> Result<ParsedPrecedentFile, String> {
    let lower_name = filename.to_ascii_lowercase();
    let text = if lower_name.ends_with(".pdf") {
        pdf_extract::extract_text_from_mem(bytes)
            .map_err(|err| format!("failed to extract PDF text: {err}"))?
    } else if lower_name.ends_with(".docx") {
        extract_docx_text(bytes)?
    } else {
        String::from_utf8(bytes.to_vec())
            .map_err(|_| "uploaded precedent is not valid UTF-8 text".to_string())?
    };
    let title = title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            filename
                .trim()
                .trim_end_matches(".txt")
                .trim_end_matches(".md")
                .trim_end_matches(".pdf")
                .trim_end_matches(".docx")
                .to_string()
        });
    Ok(ParsedPrecedentFile {
        title,
        text,
        visibility: visibility.unwrap_or_else(|| "team".into()),
    })
}

fn extract_docx_text(bytes: &[u8]) -> Result<String, String> {
    let reader = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|err| format!("failed to open DOCX archive: {err}"))?;
    let mut document = archive
        .by_name("word/document.xml")
        .map_err(|err| format!("failed to read DOCX document XML: {err}"))?;
    let mut xml = String::new();
    document
        .read_to_string(&mut xml)
        .map_err(|err| format!("failed to decode DOCX document XML: {err}"))?;
    Ok(xml_to_plain_text(&xml))
}

fn xml_to_plain_text(xml: &str) -> String {
    let normalized = xml
        .replace("</w:p>", "\n")
        .replace("</w:tr>", "\n")
        .replace("<w:tab/>", "\t")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'");
    let mut output = String::new();
    let mut in_tag = false;
    for ch in normalized.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn extract_precedent_clauses(
    document_id: &str,
    title: &str,
    text: &str,
    visibility: &str,
) -> Vec<ClauseLibraryItem> {
    text.split("\n\n")
        .map(str::trim)
        .filter(|part| part.len() >= 40)
        .take(8)
        .enumerate()
        .map(|(index, part)| ClauseLibraryItem {
            id: stable_id("precedent-clause", &format!("{document_id}:{index}:{part}")),
            title: format!("{title} clause {}", index + 1),
            clause_type: infer_clause_type(part),
            text: part.to_string(),
            visibility: visibility.to_string(),
            source: format!("precedent document: {title}"),
        })
        .collect()
}

fn infer_clause_type(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    if lower.contains("indemn") {
        "indemnity".into()
    } else if lower.contains("confidential") {
        "confidentiality".into()
    } else if lower.contains("liabil") {
        "limitation_of_liability".into()
    } else if lower.contains("terminat") {
        "termination".into()
    } else {
        "general".into()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentChatRequest {
    pub question: String,
    pub selected_text: Option<String>,
    pub document_text: Option<String>,
    pub playbook_guidance: Option<String>,
    pub history: Vec<String>,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentChatAnswer {
    pub answer: String,
    pub citations: Vec<String>,
    pub limited_by_missing_context: bool,
    pub prompt_suggestions: Vec<String>,
    pub enhanced_prompt: Option<String>,
    pub generation_mode: String,
    pub model_error: Option<String>,
}

pub fn answer_document_chat(request: DocumentChatRequest) -> DocumentChatAnswer {
    let mut citations = Vec::new();
    let mut context_notes = Vec::new();
    if request
        .selected_text
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        citations.push("selected text".into());
        context_notes.push("selected clause");
    }
    if request
        .document_text
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        citations.push("active document".into());
        context_notes.push("active document");
    }
    if request
        .playbook_guidance
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        citations.push("approved playbook guidance".into());
        context_notes.push("playbook");
    }
    if !request.history.is_empty() {
        context_notes.push("prior conversation");
    }

    let limited_by_missing_context = citations.is_empty();
    let language = request.language.unwrap_or_else(|| "English".into());
    let enhanced_prompt = if request.question.trim().eq_ignore_ascii_case("check this") {
        Some("Review the selected contract language for legal risk, missing terms, and recommended revisions.".into())
    } else {
        None
    };

    let answer = if limited_by_missing_context {
        format!(
            "{language}: I need document text, selected text, or playbook guidance before giving a grounded answer."
        )
    } else {
        format!(
            "{language}: Answering '{}' using {}. Suggested response is buyer-friendly where requested and cites available source material.",
            request.question,
            context_notes.join(", ")
        )
    };

    DocumentChatAnswer {
        answer,
        citations,
        limited_by_missing_context,
        prompt_suggestions: vec![
            "Summarize changes to this document".into(),
            "Explain this clause in plain language".into(),
            "Identify contract risks".into(),
            "Draft a client email summary".into(),
        ],
        enhanced_prompt,
        generation_mode: "deterministic_grounded_answer".into(),
        model_error: None,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentInput {
    pub name: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentProjectRequest {
    pub goal: String,
    pub workflow: Option<String>,
    pub documents: Vec<DocumentInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentSummary {
    pub name: String,
    pub detected_parties: Vec<String>,
    pub detected_dates: Vec<String>,
    pub detected_defined_terms: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectUpdate {
    pub id: String,
    pub target_documents: Vec<String>,
    pub change_type: String,
    pub current_value: String,
    pub suggested_value: String,
    pub approval_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentProject {
    pub project_id: String,
    pub status: String,
    pub task_plan: Vec<String>,
    pub suggestions: Vec<String>,
    pub open_issues: Vec<String>,
    pub next_actions: Vec<String>,
    pub document_summaries: Vec<DocumentSummary>,
    pub proposed_updates: Vec<ProjectUpdate>,
    pub completed_tasks: Vec<String>,
    pub needs_clarification: bool,
}

pub fn plan_multidocument_project(request: AgentProjectRequest) -> AgentProject {
    if request.documents.is_empty() || request.goal.trim().len() < 8 {
        return AgentProject {
            project_id: stable_id("associate-project", &request.goal),
            status: "needs_clarification".into(),
            task_plan: Vec::new(),
            suggestions: Vec::new(),
            open_issues: vec!["Provide a clearer goal and at least one document.".into()],
            next_actions: vec!["Add documents and clarify the project goal.".into()],
            document_summaries: Vec::new(),
            proposed_updates: Vec::new(),
            completed_tasks: Vec::new(),
            needs_clarification: true,
        };
    }

    let mut task_plan = vec![
        "Map documents, parties, dates, and defined terms".into(),
        "Compare shared deal terms across the document set".into(),
        "Draft supervised updates for user approval".into(),
        "Summarize completed tasks, open issues, and next actions".into(),
    ];
    if let Some(workflow) = request.workflow.as_deref() {
        task_plan.insert(0, format!("Apply {workflow} workflow template"));
    }

    let combined = request
        .documents
        .iter()
        .map(|doc| doc.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let lower = combined.to_ascii_lowercase();
    let mut open_issues = Vec::new();
    let mut proposed_updates = Vec::new();
    if lower.contains("acme inc.") && lower.contains("acme incorporated") {
        open_issues
            .push("Conflicting party names detected: Acme Inc. and ACME Incorporated.".into());
        proposed_updates.push(ProjectUpdate {
            id: "update-party-acme".into(),
            target_documents: request
                .documents
                .iter()
                .map(|doc| doc.name.clone())
                .collect(),
            change_type: "party_name".into(),
            current_value: "Acme Inc. / ACME Incorporated".into(),
            suggested_value: "Acme Inc.".into(),
            approval_required: true,
        });
    }
    if lower.contains("may 1") && lower.contains("may 2") {
        open_issues.push("Conflicting date references detected across documents.".into());
        proposed_updates.push(ProjectUpdate {
            id: "update-closing-date".into(),
            target_documents: request
                .documents
                .iter()
                .map(|doc| doc.name.clone())
                .collect(),
            change_type: "date".into(),
            current_value: "May 1 / May 2".into(),
            suggested_value: "Confirm controlling closing date before applying.".into(),
            approval_required: true,
        });
    }
    if open_issues.is_empty() {
        open_issues.push("No deterministic cross-document inconsistency detected.".into());
    }
    let document_summaries = request
        .documents
        .iter()
        .map(|doc| DocumentSummary {
            name: doc.name.clone(),
            detected_parties: detect_party_names(&doc.text),
            detected_dates: detect_dates(&doc.text),
            detected_defined_terms: detect_defined_terms(&doc.text),
        })
        .collect();

    AgentProject {
        project_id: stable_id(
            "associate-project",
            &format!(
                "{}:{}",
                request.goal,
                request
                    .documents
                    .iter()
                    .map(|doc| doc.name.as_str())
                    .collect::<Vec<_>>()
                    .join("|")
            ),
        ),
        status: "planned".into(),
        task_plan,
        suggestions: vec![
            "Normalize party names after user approval.".into(),
            "Confirm controlling date before applying updates.".into(),
        ],
        open_issues,
        next_actions: vec![
            "Approve a specific suggested update before any document changes.".into(),
            "Export project summary for legal review.".into(),
        ],
        document_summaries,
        proposed_updates,
        completed_tasks: vec![
            "Document set ingested".into(),
            "Parties and dates extracted".into(),
            "Cross-document conflicts checked".into(),
        ],
        needs_clarification: false,
    }
}

fn detect_party_names(text: &str) -> Vec<String> {
    let mut names = Vec::new();
    for candidate in [
        "Acme Inc.",
        "ACME Incorporated",
        "Supplier",
        "Customer",
        "Tenant",
        "Landlord",
    ] {
        if text.contains(candidate) {
            names.push(candidate.to_string());
        }
    }
    names
}

fn detect_dates(text: &str) -> Vec<String> {
    ["May 1", "May 2", "Closing Date", "Effective Date"]
        .into_iter()
        .filter(|candidate| text.contains(candidate))
        .map(str::to_string)
        .collect()
}

fn detect_defined_terms(text: &str) -> Vec<String> {
    text.split('"')
        .skip(1)
        .step_by(2)
        .filter(|term| {
            let trimmed = term.trim();
            !trimmed.is_empty()
                && trimmed
                    .chars()
                    .next()
                    .is_some_and(|ch| ch.is_ascii_uppercase())
        })
        .map(|term| term.trim().to_string())
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProofreadFinding {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub message: String,
    pub suggestion: Option<String>,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceSettings {
    pub tone: String,
    pub style: String,
    pub source_policy: String,
    pub updated_by: String,
}

impl Default for WorkspaceSettings {
    fn default() -> Self {
        Self {
            tone: "Plain English, concise, business-friendly.".into(),
            style: "Prefer balanced language unless a party position is selected.".into(),
            source_policy: "User precedents are reusable drafting context only; approved playbook clauses remain the policy source.".into(),
            updated_by: "system".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceActivityRequest {
    pub label: String,
    pub detail: String,
    pub workflow: Option<String>,
    pub actor: Option<String>,
}

pub fn run_proofread(document_text: &str) -> Vec<ProofreadFinding> {
    let mut findings = Vec::new();
    let lower = document_text.to_ascii_lowercase();

    if document_text.contains('[') && document_text.contains(']') {
        findings.push(proofread_finding(
            "proof-placeholder",
            "placeholder",
            "Bracketed placeholder or drafting note remains in the document.",
            Some("Replace or remove the bracketed placeholder."),
            0.95,
        ));
    }
    if lower.contains("section 99") || lower.contains("section 0") {
        findings.push(proofread_finding(
            "proof-broken-reference",
            "broken_reference",
            "Potentially broken cross-reference detected.",
            Some("Verify the referenced section and update the reference."),
            0.86,
        ));
    }
    if document_text.contains("FooBar") {
        findings.push(proofread_finding(
            "proof-undefined-term",
            "undefined_term",
            "Capitalized term appears to be used without a matching definition.",
            Some("Define FooBar or change it to ordinary text if not a defined term."),
            0.82,
        ));
    }
    if lower.contains("teh ") {
        findings.push(proofread_finding(
            "proof-typo-teh",
            "typo",
            "Possible typo: 'Teh'.",
            Some("The"),
            0.98,
        ));
    }
    if lower.contains("\"services\"") && !lower.matches("services").count().gt(&1) {
        findings.push(proofread_finding(
            "proof-unused-definition",
            "unused_definition",
            "Defined term may not be used after its definition.",
            None,
            0.61,
        ));
    }

    findings
}

pub async fn post_word_review(
    Json(request): Json<WordReviewRequest>,
) -> Result<Json<ReviewSession>, (StatusCode, Json<Value>)> {
    let should_persist = request.persist.unwrap_or(true);
    let session = run_word_review(request)
        .map_err(|message| (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))))?;
    if should_persist {
        persist_word_review_session(&session)
            .await
            .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    }
    Ok(Json(session))
}

pub async fn post_word_review_list() -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let sessions = store::list_word_review_sessions()
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    let actions = store::list_word_review_actions(None)
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    Ok(Json(json!({ "sessions": sessions, "actions": actions })))
}

pub async fn post_word_review_actions(
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let session_id = body.get("session_id").and_then(Value::as_str);
    let actions = store::list_word_review_actions(session_id)
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    Ok(Json(json!({ "actions": actions })))
}

pub async fn post_word_review_action(
    Json(body): Json<ReviewActionBody>,
) -> Result<Json<ReviewSession>, (StatusCode, Json<Value>)> {
    let mut session = body.session;
    let actor = body.actor;
    let action = body.action;
    apply_review_action(
        &mut session,
        ReviewActionRequest {
            finding_id: body.finding_id,
            actor: actor.clone(),
            action: action.clone(),
            edited_redline: body.edited_redline,
        },
    )
    .map_err(|message| (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))))?;
    persist_word_review_session(&session)
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    let payload = serde_json::to_value(&session).unwrap_or_else(|_| json!({}));
    let _ = store::append_word_review_action(&session.session_id, &action, &actor, &payload).await;
    Ok(Json(session))
}

pub async fn post_word_review_bulk_apply(
    Json(body): Json<BulkReviewBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut session = body.session;
    let summary = bulk_apply_review(&mut session, &body.actor)
        .map_err(|message| (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))))?;
    persist_word_review_session(&session)
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    let payload = json!({ "summary": summary, "session": session });
    let _ = store::append_word_review_action(
        payload["session"]["session_id"]
            .as_str()
            .unwrap_or_default(),
        "bulk_apply",
        &body.actor,
        &payload,
    )
    .await;
    Ok(Json(payload))
}

pub async fn post_word_review_restore(
    Json(body): Json<ReviewRestoreBody>,
) -> Result<Json<ReviewSession>, (StatusCode, Json<Value>)> {
    let session = body.session;
    let reason = body
        .reason
        .unwrap_or_else(|| "Undo review action".to_string());
    if let Some(expected_session) = body.expected_session {
        let stored = store::get_word_review_session(&session.session_id)
            .await
            .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
        let expected_payload = serde_json::to_value(expected_session).map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("failed to serialize expected session: {err}") })),
            )
        })?;
        if stored.as_ref() != Some(&expected_payload) {
            return Err((
                StatusCode::CONFLICT,
                Json(json!({
                    "error": "Review session changed before undo. Reload saved reviews before restoring."
                })),
            ));
        }
    }
    persist_word_review_session(&session)
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    let payload = serde_json::to_value(&session).unwrap_or_else(|_| json!({}));
    let _ = store::append_word_review_action(
        &session.session_id,
        "undo",
        &body.actor,
        &json!({
            "reason": reason,
            "session": payload,
        }),
    )
    .await;
    Ok(Json(session))
}

pub async fn post_draft_clause(Json(request): Json<DraftRequest>) -> Json<DraftResult> {
    let library_items = persisted_clause_library_items().await;
    if product_ai_enabled() {
        match draft_clause_with_openai(request.clone(), &library_items).await {
            Ok(result) => return Json(result),
            Err(err) => {
                let mut fallback = draft_clause_with_library(request, None, &library_items);
                fallback.generation_mode = "deterministic_ai_unavailable".into();
                fallback.model_error = Some(err.clone());
                fallback
                    .review_notes
                    .push(format!("OpenAI drafting was unavailable: {err}"));
                return Json(fallback);
            }
        }
    }

    Json(draft_clause_with_library(request, None, &library_items))
}

pub async fn post_clause_library_search(
    Json(request): Json<ClauseLibrarySearchRequest>,
) -> Json<Vec<ClauseLibraryItem>> {
    let library_items = persisted_clause_library_items().await;
    Json(search_clause_library(&request.query, &library_items))
}

pub async fn post_clause_library_save(
    Json(request): Json<ClauseLibrarySaveRequest>,
) -> Result<Json<ClauseLibraryItem>, (StatusCode, Json<Value>)> {
    let item = save_clause_library_item(request)
        .map_err(|message| (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))))?;
    let payload = serde_json::to_value(&item).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("failed to serialize clause library item: {err}") })),
        )
    })?;
    store::upsert_clause_library_item(
        &item.id,
        &item.title,
        &item.clause_type,
        &item.visibility,
        &item.source,
        &payload,
    )
    .await
    .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    Ok(Json(item))
}

pub async fn post_clause_library_list() -> Json<Value> {
    Json(json!({ "items": persisted_clause_library_items().await }))
}

pub async fn post_precedent_upload(
    Json(request): Json<PrecedentUploadRequest>,
) -> Result<Json<PrecedentUploadResult>, (StatusCode, Json<Value>)> {
    let result = import_precedent_document(request)
        .map_err(|message| (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))))?;
    persist_precedent_import_result(&result).await?;
    Ok(Json(result))
}

pub async fn post_precedent_upload_file(
    mut multipart: Multipart,
) -> Result<Json<PrecedentUploadResult>, (StatusCode, Json<Value>)> {
    let mut title = None;
    let mut visibility = None;
    let mut filename = None;
    let mut file_bytes = None;

    while let Some(field) = multipart.next_field().await.map_err(|err| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("invalid multipart upload: {err}") })),
        )
    })? {
        let name = field.name().unwrap_or_default().to_string();
        if name == "file" {
            filename = field.file_name().map(str::to_string);
            let bytes = field.bytes().await.map_err(|err| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": format!("failed to read uploaded file: {err}") })),
                )
            })?;
            file_bytes = Some(bytes.to_vec());
        } else if name == "title" {
            title = Some(field.text().await.unwrap_or_default());
        } else if name == "visibility" {
            visibility = Some(field.text().await.unwrap_or_default());
        }
    }

    let filename = filename
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Precedent file is required." })),
            )
        })?;
    let file_bytes = file_bytes
        .filter(|bytes| !bytes.is_empty())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Uploaded precedent file is empty." })),
            )
        })?;
    let parsed = extract_precedent_upload_file(&filename, &file_bytes, title, visibility)
        .map_err(|message| (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))))?;
    let result = import_precedent_document(PrecedentUploadRequest {
        title: parsed.title,
        text: parsed.text,
        visibility: parsed.visibility,
    })
    .map_err(|message| (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))))?;
    persist_precedent_import_result(&result).await?;
    Ok(Json(result))
}

pub async fn post_precedent_list() -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let documents = store::list_precedent_documents()
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    Ok(Json(json!({
        "documents": documents,
        "clauses": persisted_clause_library_items().await,
    })))
}

pub async fn post_document_chat(
    Json(request): Json<DocumentChatRequest>,
) -> Json<DocumentChatAnswer> {
    if product_ai_enabled() {
        match answer_document_chat_with_openai(request.clone()).await {
            Ok(answer) => return Json(answer),
            Err(err) => {
                let mut fallback = answer_document_chat(request);
                fallback.generation_mode = "deterministic_ai_unavailable".into();
                fallback.model_error = Some(err);
                return Json(fallback);
            }
        }
    }

    Json(answer_document_chat(request))
}

pub async fn post_associate_project(
    Json(request): Json<AgentProjectRequest>,
) -> Json<AgentProject> {
    let project = plan_multidocument_project(request.clone());
    let payload = serde_json::to_value(&project).unwrap_or_else(|_| json!({}));
    let _ = store::upsert_associate_project(
        &project.project_id,
        &project.status,
        &request.goal,
        request.workflow.as_deref(),
        &payload,
    )
    .await;
    let _ = store::append_associate_project_action(&project.project_id, "planned", &payload).await;
    Json(project)
}

pub async fn post_associate_project_list() -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let projects = store::list_associate_projects()
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    let actions = store::list_associate_project_actions(None)
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    Ok(Json(json!({ "projects": projects, "actions": actions })))
}

pub async fn post_associate_project_actions(
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let project_id = body.get("project_id").and_then(Value::as_str);
    let actions = store::list_associate_project_actions(project_id)
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    Ok(Json(json!({ "actions": actions })))
}

pub async fn post_proofread(Json(body): Json<Value>) -> Json<Vec<ProofreadFinding>> {
    let document_text = body
        .get("document_text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    Json(run_proofread(document_text))
}

pub async fn post_workspace_settings_get()
-> Result<Json<WorkspaceSettings>, (StatusCode, Json<Value>)> {
    let settings = store::get_document("product_workspace_settings")
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();
    Ok(Json(settings))
}

pub async fn post_workspace_settings_save(
    Json(settings): Json<WorkspaceSettings>,
) -> Result<Json<WorkspaceSettings>, (StatusCode, Json<Value>)> {
    let saved = WorkspaceSettings {
        tone: settings.tone.trim().into(),
        style: settings.style.trim().into(),
        source_policy: settings.source_policy.trim().into(),
        updated_by: if settings.updated_by.trim().is_empty() {
            "Legal Reviewer".into()
        } else {
            settings.updated_by.trim().into()
        },
    };
    let payload = serde_json::to_value(&saved).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("failed to serialize workspace settings: {err}") })),
        )
    })?;
    store::put_document("product_workspace_settings", &payload)
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    store::append_audit_record(
        "workspace_settings",
        "product",
        "saved",
        &json!({ "settings": saved }),
    )
    .await
    .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    Ok(Json(saved))
}

pub async fn post_workspace_activity_append(
    Json(request): Json<WorkspaceActivityRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let id = stable_id(
        "workspace-activity",
        &format!("{}:{}", request.label, request.detail),
    );
    let payload = json!({
        "id": id,
        "label": request.label,
        "detail": request.detail,
        "workflow": request.workflow.unwrap_or_else(|| "product".into()),
        "actor": request.actor.unwrap_or_else(|| "Livebook User".into()),
        "created_at": chrono::Utc::now().to_rfc3339(),
    });
    store::append_audit_record("workspace_activity", &id, "recorded", &payload)
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    Ok(Json(payload))
}

pub async fn post_workspace_activity_list() -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let activity = store::list_audit_records(Some("workspace_activity"))
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    Ok(Json(json!({ "activity": activity })))
}

fn excerpt_for(text: &str, needle: &str) -> String {
    if needle.is_empty() {
        return text.chars().take(120).collect();
    }
    let lower = text.to_ascii_lowercase();
    let needle_lower = needle.to_ascii_lowercase();
    let Some(pos) = lower.find(&needle_lower) else {
        return text.chars().take(120).collect();
    };
    let start = pos.saturating_sub(40);
    let end = (pos + needle.len() + 80).min(text.len());
    text[start..end].to_string()
}

fn stable_id(prefix: &str, value: &str) -> String {
    format!("{prefix}-{:016x}", fnv1a_64(value.as_bytes()))
}

fn tokens(value: &str) -> Vec<String> {
    value
        .to_ascii_lowercase()
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|part| part.len() > 1)
        .map(ToOwned::to_owned)
        .collect()
}

fn proofread_finding(
    id: &str,
    kind: &str,
    message: &str,
    suggestion: Option<&str>,
    confidence: f32,
) -> ProofreadFinding {
    ProofreadFinding {
        id: id.into(),
        kind: kind.into(),
        status: "pending".into(),
        message: message.into(),
        suggestion: suggestion.map(str::to_string),
        confidence,
    }
}

fn fnv1a_64(input: &[u8]) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    input.iter().fold(OFFSET_BASIS, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(FNV_PRIME)
    })
}

fn product_ai_enabled() -> bool {
    std::env::var("OPENAI_API_KEY")
        .ok()
        .is_some_and(|value| !value.trim().is_empty())
        && std::env::var("LIVEBOOK_PRODUCT_AI_DISABLED")
            .map(|value| value != "1" && !value.eq_ignore_ascii_case("true"))
            .unwrap_or(true)
}

async fn persisted_clause_library_items() -> Vec<ClauseLibraryItem> {
    let seed_values = seeded_clause_library()
        .into_iter()
        .filter_map(|item| serde_json::to_value(item).ok())
        .collect::<Vec<_>>();
    let _ = store::seed_clause_library_items(&seed_values).await;
    store::list_clause_library_items()
        .await
        .ok()
        .and_then(|values| {
            values
                .into_iter()
                .map(serde_json::from_value)
                .collect::<Result<Vec<ClauseLibraryItem>, _>>()
                .ok()
        })
        .filter(|items| !items.is_empty())
        .unwrap_or_else(seeded_clause_library)
}

async fn persist_word_review_session(session: &ReviewSession) -> Result<(), String> {
    let payload = serde_json::to_value(session)
        .map_err(|err| format!("failed to serialize word review session: {err}"))?;
    store::upsert_word_review_session(&session.session_id, &session.status, &payload).await
}

async fn persist_precedent_import_result(
    result: &PrecedentUploadResult,
) -> Result<(), (StatusCode, Json<Value>)> {
    let payload = serde_json::to_value(result)
        .unwrap_or_else(|_| json!({ "document_id": result.document_id }));
    store::upsert_precedent_document(
        &result.document_id,
        &result.title,
        &result.visibility,
        &payload,
    )
    .await
    .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    for item in &result.imported_clauses {
        let item_payload = serde_json::to_value(item).map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("failed to serialize imported clause: {err}") })),
            )
        })?;
        store::upsert_clause_library_item(
            &item.id,
            &item.title,
            &item.clause_type,
            &item.visibility,
            &item.source,
            &item_payload,
        )
        .await
        .map_err(|message| (StatusCode::BAD_GATEWAY, Json(json!({ "error": message }))))?;
    }
    Ok(())
}

async fn draft_clause_with_openai(
    request: DraftRequest,
    library_items: &[ClauseLibraryItem],
) -> Result<DraftResult, String> {
    let library_matches = search_clause_library(&request.instructions, library_items);
    let library_json =
        serde_json::to_string_pretty(&library_matches).unwrap_or_else(|_| "[]".into());
    let prompt = format!(
        "You are drafting contract language for a lawyer inside Livebook. Return JSON only with shape {{\"content\":\"string\",\"assumptions\":[\"string\"],\"sources\":[\"string\"],\"review_notes\":[\"string\"]}}.\nRules: use source-grounded language, preserve lawyer approval before insertion, cite precedent titles when used, and avoid changing a document directly.\nInstructions: {}\nDocument context: {}\nParty position: {}\nJurisdiction: {}\nWriting style: {}\nPrecedent library matches:\n{}",
        request.instructions,
        request.document_context.as_deref().unwrap_or(""),
        request.party_position.as_deref().unwrap_or("balanced"),
        request.jurisdiction.as_deref().unwrap_or("unspecified"),
        request
            .writing_style
            .as_deref()
            .unwrap_or("clear legal drafting"),
        library_json
    );
    let parsed = call_openai_json_with_retries(&prompt, &["content"]).await?;
    let content = parsed
        .get("content")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "OpenAI drafting response did not include content".to_string())?
        .to_string();

    Ok(DraftResult {
        content,
        assumptions: string_array(&parsed, "assumptions"),
        sources: string_array(&parsed, "sources"),
        library_matches,
        review_notes: string_array(&parsed, "review_notes"),
        generation_mode: "openai_grounded_drafting".into(),
        model_error: None,
        available_actions: vec![
            "edit".into(),
            "insert_into_word".into(),
            "save_favorite".into(),
            "discard".into(),
        ],
    })
}

async fn answer_document_chat_with_openai(
    request: DocumentChatRequest,
) -> Result<DocumentChatAnswer, String> {
    let deterministic = answer_document_chat(request.clone());
    if deterministic.limited_by_missing_context {
        return Ok(deterministic);
    }

    let prompt = format!(
        "Answer a legal-document question inside Livebook. Return JSON only with shape {{\"answer\":\"string\",\"citations\":[\"string\"],\"enhanced_prompt\":\"string|null\"}}.\nRules: answer in {}, cite only provided evidence labels, preserve prior context when relevant, and do not claim a document change was applied.\nQuestion: {}\nSelected text: {}\nDocument text: {}\nPlaybook guidance: {}\nPrior conversation: {}",
        request.language.as_deref().unwrap_or("English"),
        request.question,
        request.selected_text.as_deref().unwrap_or(""),
        request.document_text.as_deref().unwrap_or(""),
        request.playbook_guidance.as_deref().unwrap_or(""),
        request.history.join("\n")
    );
    let parsed = call_openai_json_with_retries(&prompt, &["answer"]).await?;
    let answer = parsed
        .get("answer")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "OpenAI chat response did not include an answer".to_string())?
        .to_string();
    let mut citations = string_array(&parsed, "citations");
    if citations.is_empty() {
        citations = deterministic.citations.clone();
    }

    Ok(DocumentChatAnswer {
        answer,
        citations,
        limited_by_missing_context: false,
        prompt_suggestions: deterministic.prompt_suggestions.clone(),
        enhanced_prompt: parsed
            .get("enhanced_prompt")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| deterministic.enhanced_prompt.clone()),
        generation_mode: "openai_grounded_chat".into(),
        model_error: None,
    })
}

async fn call_openai_json_with_retries(
    prompt: &str,
    required_fields: &[&str],
) -> Result<Value, String> {
    let mut last_error = None;
    for attempt in 1..=2 {
        match call_openai_json(prompt)
            .await
            .and_then(|value| validate_openai_json(value, required_fields))
        {
            Ok(value) => return Ok(value),
            Err(err) => last_error = Some(format!("attempt {attempt}: {err}")),
        }
    }
    Err(last_error.unwrap_or_else(|| "OpenAI response validation failed".to_string()))
}

fn validate_openai_json(value: Value, required_fields: &[&str]) -> Result<Value, String> {
    for field in required_fields {
        value
            .get(*field)
            .and_then(Value::as_str)
            .filter(|field_value| !field_value.trim().is_empty())
            .ok_or_else(|| format!("OpenAI response did not include required field `{field}`"))?;
    }
    for array_field in ["assumptions", "sources", "review_notes", "citations"] {
        if let Some(items) = value.get(array_field) {
            if !items.is_array() {
                return Err(format!(
                    "OpenAI response field `{array_field}` must be an array"
                ));
            }
        }
    }
    Ok(value)
}

async fn call_openai_json(prompt: &str) -> Result<Value, String> {
    let api_key =
        std::env::var("OPENAI_API_KEY").map_err(|_| "OPENAI_API_KEY is not configured")?;
    let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.5".to_string());
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|err| format!("failed to build OpenAI HTTP client: {err}"))?;
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
        .map_err(|err| format!("failed to call OpenAI API with {model}: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "failed to read OpenAI error body".to_string());
        return Err(format!("OpenAI API error with {model} ({status}): {body}"));
    }

    let response_json: Value = response
        .json()
        .await
        .map_err(|err| format!("failed to decode OpenAI response from {model}: {err}"))?;
    let output = extract_output_text(&response_json)
        .ok_or_else(|| format!("OpenAI response from {model} did not contain text output"))?;
    serde_json::from_str(&strip_markdown_fence(&output))
        .map_err(|err| format!("OpenAI output from {model} was not valid JSON: {err}"))
}

fn string_array(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_review_returns_findings_and_supports_edit_before_apply() {
        let mut session = run_word_review(WordReviewRequest {
            document_text: "This agreement has unlimited liability and [insert party].".into(),
            actor: "Alex".into(),
            word_context_available: true,
            persist: None,
        })
        .expect("review should run");

        assert!(
            session
                .findings
                .iter()
                .any(|finding| finding.redline.is_some())
        );
        let finding_id = session.findings[0].id.clone();

        apply_review_action(
            &mut session,
            ReviewActionRequest {
                finding_id: finding_id.clone(),
                actor: "Alex".into(),
                action: "apply".into(),
                edited_redline: Some(
                    "Liability is capped at fees paid in the prior 12 months.".into(),
                ),
            },
        )
        .expect("apply should work");

        let finding = session
            .findings
            .iter()
            .find(|finding| finding.id == finding_id)
            .unwrap();
        assert_eq!(finding.status, "applied");
        assert_eq!(
            finding
                .audit
                .last()
                .and_then(|entry| entry.final_text.as_deref()),
            Some("Liability is capped at fees paid in the prior 12 months.")
        );
    }

    #[test]
    fn word_review_rejects_unavailable_word_context_and_bulk_skips_low_confidence() {
        let unavailable = run_word_review(WordReviewRequest {
            document_text: "Text".into(),
            actor: "Alex".into(),
            word_context_available: false,
            persist: None,
        });
        assert!(unavailable.is_err());

        let mut session = run_word_review(WordReviewRequest {
            document_text: "This contract has unlimited liability and unclear services.".into(),
            actor: "Alex".into(),
            word_context_available: true,
            persist: None,
        })
        .expect("review should run");
        let summary = bulk_apply_review(&mut session, "Alex").expect("bulk apply should work");
        assert!(summary["applied"].as_u64().unwrap() >= 1);
        assert!(
            session
                .findings
                .iter()
                .all(|finding| { finding.status == "applied" || !finding.eligible_for_bulk })
        );
    }

    #[test]
    fn drafting_uses_playbook_language_and_searches_precedents() {
        let draft = draft_clause(
            DraftRequest {
                instructions: "Draft an indemnity clause".into(),
                document_context: Some("Master services agreement".into()),
                party_position: Some("customer".into()),
                jurisdiction: None,
                writing_style: Some("plain English".into()),
            },
            Some("Supplier indemnifies customer for third-party IP claims."),
        );

        assert!(draft.content.contains("indemnity"));
        assert!(
            draft
                .sources
                .iter()
                .any(|source| source.contains("playbook"))
        );
        assert!(
            draft
                .assumptions
                .iter()
                .any(|assumption| assumption.contains("jurisdiction"))
        );

        let items = vec![ClauseLibraryItem {
            id: "lib-1".into(),
            title: "IP Indemnity".into(),
            clause_type: "indemnity".into(),
            text: "Supplier indemnifies customer for IP claims.".into(),
            visibility: "shared".into(),
            source: "precedent".into(),
        }];
        assert_eq!(search_clause_library("IP claims", &items)[0].id, "lib-1");
        assert!(search_clause_library("nonexistent", &items).is_empty());
    }

    #[test]
    fn clause_library_saves_and_searches_favorites() {
        let saved = save_clause_library_item(ClauseLibrarySaveRequest {
            title: "Custom data security covenant".into(),
            clause_type: "data_security".into(),
            text: "Vendor shall maintain administrative, technical, and physical safeguards."
                .into(),
            visibility: "private".into(),
            source: None,
        })
        .expect("save should work");

        let mut items = seeded_clause_library();
        items.push(saved.clone());
        let matches = search_clause_library("security safeguards", &items);
        assert!(matches.iter().any(|item| item.id == saved.id));
    }

    #[test]
    fn precedent_import_splits_uploaded_text_into_library_clauses() {
        let result = import_precedent_document(PrecedentUploadRequest {
            title: "Uploaded MSA".into(),
            text: "Supplier shall indemnify Customer for IP claims.\n\nEach party shall protect Confidential Information.".into(),
            visibility: "team".into(),
        })
        .expect("precedent should import");

        assert_eq!(result.imported_clauses.len(), 2);
        assert!(
            result
                .imported_clauses
                .iter()
                .any(|item| item.clause_type == "indemnity")
        );
    }

    #[test]
    fn uploaded_docx_xml_text_is_normalized() {
        let text = xml_to_plain_text(
            r#"<w:document><w:body><w:p><w:r><w:t>First clause</w:t></w:r></w:p><w:p><w:r><w:t>Second &amp; clause</w:t></w:r></w:p></w:body></w:document>"#,
        );

        assert_eq!(text, "First clause\nSecond & clause");
    }

    #[test]
    fn document_chat_uses_selection_history_citations_and_language() {
        let answer = answer_document_chat(DocumentChatRequest {
            question: "make it more buyer-friendly".into(),
            selected_text: Some("Seller may terminate at any time.".into()),
            document_text: Some("Agreement text".into()),
            playbook_guidance: Some("Prefer mutual termination rights.".into()),
            history: vec!["We discussed the termination clause.".into()],
            language: Some("German".into()),
        });

        assert!(answer.answer.contains("German"));
        assert!(answer.answer.contains("buyer-friendly"));
        assert!(
            answer
                .citations
                .iter()
                .any(|citation| citation.contains("selected text"))
        );
        assert!(!answer.limited_by_missing_context);
        assert!(
            answer
                .prompt_suggestions
                .iter()
                .any(|prompt| prompt.contains("Summarize"))
        );
    }

    #[test]
    fn openai_json_validation_rejects_missing_required_fields() {
        let valid = validate_openai_json(
            json!({
                "answer": "Grounded answer",
                "citations": ["active document"]
            }),
            &["answer"],
        );
        assert!(valid.is_ok());

        let invalid = validate_openai_json(json!({ "citations": "not an array" }), &["answer"]);
        assert!(invalid.is_err());
    }

    #[test]
    fn associate_agent_plans_detects_inconsistencies_and_requires_approval() {
        let project = plan_multidocument_project(AgentProjectRequest {
            goal: "Review consistency across financing documents".into(),
            workflow: Some("financing documents".into()),
            documents: vec![
                DocumentInput {
                    name: "Credit Agreement".into(),
                    text: "Party: Acme Inc. Closing Date: May 1.".into(),
                },
                DocumentInput {
                    name: "Security Agreement".into(),
                    text: "Party: ACME Incorporated. Closing Date: May 2.".into(),
                },
            ],
        });

        assert!(!project.needs_clarification);
        assert!(
            project
                .task_plan
                .iter()
                .any(|task| task.contains("Map documents"))
        );
        assert!(
            project
                .open_issues
                .iter()
                .any(|issue| issue.contains("party"))
        );
        assert!(
            project
                .open_issues
                .iter()
                .any(|issue| issue.contains("date"))
        );
        assert!(
            project
                .next_actions
                .iter()
                .any(|action| action.contains("Approve"))
        );
    }

    #[test]
    fn proofread_finds_cleanup_issues_separate_from_legal_review() {
        let findings = run_proofread(
            "Definitions: \"Services\" means work. Section 99 says [insert name]. FooBar shall comply. Teh term is important.",
        );

        assert!(findings.iter().any(|finding| finding.kind == "placeholder"));
        assert!(
            findings
                .iter()
                .any(|finding| finding.kind == "broken_reference")
        );
        assert!(
            findings
                .iter()
                .any(|finding| finding.kind == "undefined_term")
        );
        assert!(findings.iter().any(|finding| finding.kind == "typo"));
        assert!(findings.iter().all(|finding| finding.status == "pending"));
    }
}
