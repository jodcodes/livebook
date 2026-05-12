use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{instrument, warn};
use utoipa::{IntoParams, ToSchema};

use crate::repositories::store;
use crate::routes::chat_queries::{
    ChatQueryActor, link_chat_query_to_escalation, update_chat_query_review,
};

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct EscalationActor {
    pub user_id: String,
    pub display_name: String,
    pub email: String,
    pub role: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct EscalationSource {
    pub source: String,
    pub session_id: String,
    pub message_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct EscalationLawyer {
    pub user_id: String,
    pub display_name: String,
    pub email: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NotificationMetadata {
    pub status: String,
    pub sent_at: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateEscalationRequest {
    pub query_id: Option<String>,
    pub created_by: EscalationActor,
    pub created_from: EscalationSource,
    pub lawyer: EscalationLawyer,
    pub question: String,
    pub answer: String,
    pub clause_ref: String,
    pub position_used: String,
    pub escalation_reason: Option<String>,
    pub next_action: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ResolveEscalationRequest {
    pub reviewed_by: EscalationActor,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DeclineEscalationRequest {
    pub reviewed_by: EscalationActor,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct EscalationItem {
    pub id: String,
    pub r#type: String,
    pub status: String,
    pub query_id: Option<String>,
    pub created_at: String,
    pub created_by: EscalationActor,
    pub created_from: EscalationSource,
    pub lawyer: EscalationLawyer,
    pub question: String,
    pub answer: String,
    pub clause_ref: String,
    pub position_used: String,
    pub escalation_reason: String,
    pub next_action: String,
    pub notification: NotificationMetadata,
    pub reviewed_at: Option<String>,
    pub reviewed_by: Option<EscalationActor>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct CreateEscalationResponse {
    pub item: EscalationItem,
    pub notification_result: NotificationMetadata,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct EscalationQueueQuery {
    pub status: Option<String>,
}

#[utoipa::path(
    post,
    path = "/escalations",
    request_body = CreateEscalationRequest,
    responses(
        (status = 201, description = "Chat escalation queued for lawyer review.", body = CreateEscalationResponse),
        (status = 400, description = "Missing required escalation fields."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Escalation"
)]
#[instrument(skip(body))]
pub async fn create_escalation(
    Json(body): Json<CreateEscalationRequest>,
) -> Result<(StatusCode, Json<CreateEscalationResponse>), (StatusCode, String)> {
    let (item, notification) = queue_escalation(body).await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateEscalationResponse {
            item,
            notification_result: notification,
        }),
    ))
}

pub async fn queue_escalation(
    body: CreateEscalationRequest,
) -> Result<(EscalationItem, NotificationMetadata), (StatusCode, String)> {
    validate_create_request(&body)?;

    let notification = notify_lawyer(&body);
    if notification.status == "failed" {
        warn!(
            lawyer = %body.lawyer.email,
            "lawyer escalation notification failed; item remains queued"
        );
    }

    let query_id = body.query_id.clone();
    let item = build_escalation_item(body, notification.clone(), Utc::now().to_rfc3339());
    let mut queue = read_escalation_queue().await?;
    queue.push(item.clone());
    write_escalation_queue(&queue).await?;
    link_chat_query_to_escalation(query_id.as_deref(), &item.id).await?;

    Ok((item, notification))
}

#[utoipa::path(
    get,
    path = "/escalations",
    params(EscalationQueueQuery),
    responses(
        (status = 200, description = "Escalation review queue.", body = Vec<EscalationItem>),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Escalation"
)]
#[instrument]
pub async fn get_escalations(
    Query(query): Query<EscalationQueueQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let status = query.status.unwrap_or_else(|| "pending_review".to_string());
    let entries = read_escalation_queue()
        .await?
        .into_iter()
        .filter(|entry| status == "all" || entry.status == status)
        .collect::<Vec<_>>();
    Ok(Json(
        serde_json::to_value(entries).unwrap_or(Value::Array(vec![])),
    ))
}

#[utoipa::path(
    post,
    path = "/escalations/{id}/resolve",
    params(("id" = String, Path, description = "Escalation review item ID")),
    request_body = ResolveEscalationRequest,
    responses(
        (status = 200, description = "Escalation review item resolved.", body = EscalationItem),
        (status = 404, description = "Escalation review item not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Escalation"
)]
#[instrument(skip(body))]
pub async fn resolve_escalation(
    Path(id): Path<String>,
    Json(body): Json<ResolveEscalationRequest>,
) -> Result<Json<EscalationItem>, (StatusCode, String)> {
    validate_actor("reviewed_by", &body.reviewed_by)?;

    let mut queue = read_escalation_queue().await?;
    let idx = queue.iter().position(|entry| entry.id == id).ok_or((
        StatusCode::NOT_FOUND,
        "escalation item not found".to_string(),
    ))?;

    let reviewed_by = body.reviewed_by;
    let reviewed_at = Utc::now().to_rfc3339();
    apply_resolution(&mut queue[idx], reviewed_by.clone(), reviewed_at.clone());
    let item = queue[idx].clone();
    write_escalation_queue(&queue).await?;
    update_chat_query_review(
        item.query_id.as_deref(),
        &item.id,
        "approved",
        actor_to_chat_query_actor(reviewed_by),
        reviewed_at,
    )
    .await?;

    Ok(Json(item))
}

#[utoipa::path(
    post,
    path = "/escalations/{id}/decline",
    params(("id" = String, Path, description = "Escalation review item ID")),
    request_body = DeclineEscalationRequest,
    responses(
        (status = 200, description = "Escalation review item declined.", body = EscalationItem),
        (status = 404, description = "Escalation review item not found."),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Escalation"
)]
#[instrument(skip(body))]
pub async fn decline_escalation(
    Path(id): Path<String>,
    Json(body): Json<DeclineEscalationRequest>,
) -> Result<Json<EscalationItem>, (StatusCode, String)> {
    validate_actor("reviewed_by", &body.reviewed_by)?;

    let mut queue = read_escalation_queue().await?;
    let idx = queue.iter().position(|entry| entry.id == id).ok_or((
        StatusCode::NOT_FOUND,
        "escalation item not found".to_string(),
    ))?;

    let reviewed_by = body.reviewed_by;
    let reviewed_at = Utc::now().to_rfc3339();
    apply_review_status(
        &mut queue[idx],
        "declined",
        reviewed_by.clone(),
        reviewed_at.clone(),
    );
    let item = queue[idx].clone();
    write_escalation_queue(&queue).await?;
    update_chat_query_review(
        item.query_id.as_deref(),
        &item.id,
        "rejected",
        actor_to_chat_query_actor(reviewed_by),
        reviewed_at,
    )
    .await?;

    Ok(Json(item))
}

fn validate_create_request(body: &CreateEscalationRequest) -> Result<(), (StatusCode, String)> {
    validate_actor("created_by", &body.created_by)?;
    validate_lawyer(&body.lawyer)?;
    require("created_from.source", &body.created_from.source)?;
    require("created_from.message_id", &body.created_from.message_id)?;
    require("question", &body.question)?;
    require("answer", &body.answer)?;
    require("clause_ref", &body.clause_ref)?;
    require("position_used", &body.position_used)?;
    Ok(())
}

fn validate_actor(name: &str, actor: &EscalationActor) -> Result<(), (StatusCode, String)> {
    if actor.display_name.trim().is_empty() && actor.email.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("{name} requires display_name or email"),
        ));
    }
    Ok(())
}

fn validate_lawyer(lawyer: &EscalationLawyer) -> Result<(), (StatusCode, String)> {
    if lawyer.display_name.trim().is_empty() && lawyer.email.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "lawyer requires display_name or email".to_string(),
        ));
    }
    Ok(())
}

fn require(name: &str, value: &str) -> Result<(), (StatusCode, String)> {
    if value.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, format!("{name} must not be empty")));
    }
    Ok(())
}

fn build_escalation_item(
    body: CreateEscalationRequest,
    notification: NotificationMetadata,
    created_at: String,
) -> EscalationItem {
    EscalationItem {
        id: escalation_id(&created_at, &body.created_from.message_id),
        r#type: "chat_escalation".to_string(),
        status: "pending_review".to_string(),
        query_id: body.query_id,
        created_at,
        created_by: body.created_by,
        created_from: body.created_from,
        lawyer: body.lawyer,
        question: body.question,
        answer: body.answer,
        clause_ref: body.clause_ref,
        position_used: body.position_used,
        escalation_reason: body.escalation_reason.unwrap_or_default(),
        next_action: body.next_action,
        notification,
        reviewed_at: None,
        reviewed_by: None,
    }
}

fn actor_to_chat_query_actor(actor: EscalationActor) -> ChatQueryActor {
    ChatQueryActor {
        user_id: actor.user_id,
        display_name: actor.display_name,
        email: actor.email,
        role: actor.role,
    }
}

fn apply_resolution(item: &mut EscalationItem, reviewer: EscalationActor, reviewed_at: String) {
    apply_review_status(item, "resolved", reviewer, reviewed_at);
}

fn apply_review_status(
    item: &mut EscalationItem,
    status: &str,
    reviewer: EscalationActor,
    reviewed_at: String,
) {
    item.status = status.to_string();
    item.reviewed_at = Some(reviewed_at);
    item.reviewed_by = Some(reviewer);
}

fn notify_lawyer(body: &CreateEscalationRequest) -> NotificationMetadata {
    let status = if body.lawyer.email.to_ascii_lowercase().contains("fail") {
        "failed"
    } else if store::config()
        .map(|config| config.notification_mode.eq_ignore_ascii_case("sent"))
        .unwrap_or(false)
    {
        "sent"
    } else {
        "queued"
    };
    let message = match status {
        "failed" => format!(
            "Failed to notify {} for {}. Review link: /review",
            body.lawyer.email, body.clause_ref
        ),
        "sent" => format!(
            "Notification sent to {} for {} from {}. Review link: /review",
            body.lawyer.email, body.clause_ref, body.created_by.display_name
        ),
        _ => format!(
            "Notification queued for {} for {} from {}. Review link: /review",
            body.lawyer.email, body.clause_ref, body.created_by.display_name
        ),
    };

    NotificationMetadata {
        status: status.to_string(),
        sent_at: Utc::now().to_rfc3339(),
        message,
    }
}

fn escalation_id(created_at: &str, message_id: &str) -> String {
    let suffix = created_at
        .chars()
        .chain(message_id.chars())
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>();
    format!("ESC-{}", suffix)
}

async fn read_escalation_queue() -> Result<Vec<EscalationItem>, (StatusCode, String)> {
    store::list_escalations()
        .await
        .map_err(internal_error)?
        .into_iter()
        .map(|value| {
            serde_json::from_value(value).map_err(|err| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("stored escalation payload is invalid: {err}"),
                )
            })
        })
        .collect()
}

async fn write_escalation_queue(queue: &[EscalationItem]) -> Result<(), (StatusCode, String)> {
    for item in queue {
        let payload = serde_json::to_value(item).map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to serialize escalation payload: {err}"),
            )
        })?;
        store::upsert_escalation(&item.id, item.query_id.as_deref(), &item.status, &payload)
            .await
            .map_err(internal_error)?;
    }
    Ok(())
}

fn internal_error(message: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> CreateEscalationRequest {
        CreateEscalationRequest {
            query_id: Some("Q-1".to_string()),
            created_by: EscalationActor {
                user_id: "local-user".to_string(),
                display_name: "Business User".to_string(),
                email: "business@livebook.com".to_string(),
                role: "business_user".to_string(),
            },
            created_from: EscalationSource {
                source: "chat".to_string(),
                session_id: "session-1".to_string(),
                message_id: "message-1".to_string(),
            },
            lawyer: EscalationLawyer {
                user_id: "lawyer".to_string(),
                display_name: "Legal Counsel".to_string(),
                email: "legal@livebook.com".to_string(),
            },
            question: "Can we accept unlimited liability?".to_string(),
            answer: "Escalation required.".to_string(),
            clause_ref: "C01 Liability".to_string(),
            position_used: "fallback_2".to_string(),
            escalation_reason: Some("Customer asked for uncapped liability".to_string()),
            next_action: "Escalate before responding.".to_string(),
        }
    }

    #[test]
    fn build_item_preserves_audit_metadata() {
        let notification = NotificationMetadata {
            status: "queued".to_string(),
            sent_at: "2026-04-25T12:00:00Z".to_string(),
            message: "queued".to_string(),
        };
        let item =
            build_escalation_item(request(), notification, "2026-04-25T12:00:00Z".to_string());

        assert_eq!(item.status, "pending_review");
        assert_eq!(item.r#type, "chat_escalation");
        assert_eq!(item.query_id, Some("Q-1".to_string()));
        assert_eq!(item.created_at, "2026-04-25T12:00:00Z");
        assert_eq!(item.created_by.display_name, "Business User");
        assert_eq!(item.created_from.source, "chat");
    }

    #[test]
    fn validation_rejects_missing_audit_identity() {
        let mut body = request();
        body.created_by.display_name.clear();
        body.created_by.email.clear();

        assert!(validate_create_request(&body).is_err());
    }

    #[test]
    fn notification_failure_status_does_not_block_item_shape() {
        let mut body = request();
        body.lawyer.email = "fail@livebook.com".to_string();
        let notification = notify_lawyer(&body);
        let item = build_escalation_item(body, notification, "2026-04-25T12:00:00Z".to_string());

        assert_eq!(item.notification.status, "failed");
        assert!(item.notification.message.contains("/review"));
        assert_eq!(item.status, "pending_review");
    }

    #[test]
    fn resolve_records_reviewer_and_timestamp() {
        let notification = NotificationMetadata {
            status: "queued".to_string(),
            sent_at: "2026-04-25T12:00:00Z".to_string(),
            message: "queued".to_string(),
        };
        let mut item =
            build_escalation_item(request(), notification, "2026-04-25T12:00:00Z".to_string());
        let reviewer = EscalationActor {
            user_id: "local-lawyer".to_string(),
            display_name: "Legal Counsel".to_string(),
            email: "legal@livebook.com".to_string(),
            role: "lawyer".to_string(),
        };

        apply_resolution(&mut item, reviewer, "2026-04-25T12:05:00Z".to_string());

        assert_eq!(item.status, "resolved");
        assert_eq!(item.reviewed_at, Some("2026-04-25T12:05:00Z".to_string()));
        assert_eq!(
            item.reviewed_by.map(|actor| actor.display_name),
            Some("Legal Counsel".to_string())
        );
    }
}
