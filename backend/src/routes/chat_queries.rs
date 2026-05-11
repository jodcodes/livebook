use axum::{Json, http::StatusCode};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    auth::{ActorIdentity, default_actor_for_role},
    repositories::store,
};

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ChatQueryActor {
    pub user_id: String,
    pub display_name: String,
    pub email: String,
    pub role: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ChatQueryItem {
    pub id: String,
    pub session_id: String,
    pub created_at: String,
    pub created_by: ChatQueryActor,
    pub question: String,
    pub answer: String,
    pub clause_ref: String,
    pub position_used: String,
    pub escalation_required: bool,
    pub next_action: String,
    pub status: String,
    pub escalation_id: Option<String>,
    pub reviewed_at: Option<String>,
    pub reviewed_by: Option<ChatQueryActor>,
}

#[derive(Clone, Debug)]
pub struct CreateChatQuery {
    pub session_id: Option<String>,
    pub created_by: Option<ChatQueryActor>,
    pub question: String,
    pub answer: String,
    pub clause_ref: String,
    pub position_used: String,
    pub escalation_required: bool,
    pub next_action: String,
}

#[utoipa::path(
    get,
    path = "/chat-queries",
    responses(
        (status = 200, description = "Shared chat question history.", body = Vec<ChatQueryItem>),
        (status = 500, description = "Server-side processing failure.")
    ),
    tag = "Question"
)]
pub async fn get_chat_queries() -> Result<Json<Vec<ChatQueryItem>>, (StatusCode, String)> {
    Ok(Json(read_chat_queries().await?))
}

pub async fn record_chat_query(
    input: CreateChatQuery,
) -> Result<ChatQueryItem, (StatusCode, String)> {
    let created_at = Utc::now().to_rfc3339();
    let item = build_chat_query_item(input, created_at);
    let mut queries = read_chat_queries().await?;
    queries.push(item.clone());
    write_chat_queries(&queries).await?;
    Ok(item)
}

pub async fn link_chat_query_to_escalation(
    query_id: Option<&str>,
    escalation_id: &str,
) -> Result<(), (StatusCode, String)> {
    let Some(query_id) = query_id.filter(|id| !id.trim().is_empty()) else {
        return Ok(());
    };

    let mut queries = read_chat_queries().await?;
    if let Some(query) = queries.iter_mut().find(|query| query.id == query_id) {
        apply_escalation_link(query, escalation_id);
        write_chat_queries(&queries).await?;
    }
    Ok(())
}

pub async fn update_chat_query_review(
    query_id: Option<&str>,
    escalation_id: &str,
    status: &str,
    reviewed_by: ChatQueryActor,
    reviewed_at: String,
) -> Result<(), (StatusCode, String)> {
    let mut queries = read_chat_queries().await?;
    let query = queries.iter_mut().find(|query| {
        query_id
            .filter(|id| !id.trim().is_empty())
            .is_some_and(|id| query.id == id)
            || query.escalation_id.as_deref() == Some(escalation_id)
    });

    if let Some(query) = query {
        apply_review_status(query, status, reviewed_by, reviewed_at);
        write_chat_queries(&queries).await?;
    }
    Ok(())
}

fn build_chat_query_item(input: CreateChatQuery, created_at: String) -> ChatQueryItem {
    let session_id = input
        .session_id
        .unwrap_or_else(|| "legacy-chat".to_string());
    ChatQueryItem {
        id: chat_query_id(&created_at, &session_id),
        session_id,
        created_at,
        created_by: input.created_by.unwrap_or_else(default_chat_actor),
        question: input.question,
        answer: input.answer,
        clause_ref: input.clause_ref,
        position_used: input.position_used,
        escalation_required: input.escalation_required,
        next_action: input.next_action,
        status: if input.escalation_required {
            "escalated".to_string()
        } else {
            "resolved".to_string()
        },
        escalation_id: None,
        reviewed_at: None,
        reviewed_by: None,
    }
}

fn apply_escalation_link(query: &mut ChatQueryItem, escalation_id: &str) {
    query.status = "escalated".to_string();
    query.escalation_id = Some(escalation_id.to_string());
}

fn apply_review_status(
    query: &mut ChatQueryItem,
    status: &str,
    reviewed_by: ChatQueryActor,
    reviewed_at: String,
) {
    query.status = status.to_string();
    query.reviewed_at = Some(reviewed_at);
    query.reviewed_by = Some(reviewed_by);
}

fn default_chat_actor() -> ChatQueryActor {
    let config = store::config().expect("application config not initialized");
    let actor = default_actor_for_role(config, "business");
    actor_identity_to_chat(actor)
}

fn chat_query_id(created_at: &str, session_id: &str) -> String {
    let suffix = created_at
        .chars()
        .chain(session_id.chars())
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>();
    format!("Q-{suffix}")
}

async fn read_chat_queries() -> Result<Vec<ChatQueryItem>, (StatusCode, String)> {
    let rows = store::list_chat_queries().await.map_err(internal_error)?;
    rows.into_iter()
        .map(|value| {
            serde_json::from_value(value).map_err(|err| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("stored chat query payload is invalid: {err}"),
                )
            })
        })
        .collect()
}

async fn write_chat_queries(queries: &[ChatQueryItem]) -> Result<(), (StatusCode, String)> {
    for query in queries {
        let payload = serde_json::to_value(query).map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to serialize chat query payload: {err}"),
            )
        })?;
        store::upsert_chat_query(
            &query.id,
            &query.session_id,
            &query.status,
            &query.question,
            &query.answer,
            &query.clause_ref,
            query.escalation_required,
            &payload,
        )
        .await
        .map_err(internal_error)?;
    }
    Ok(())
}

fn actor_identity_to_chat(actor: ActorIdentity) -> ChatQueryActor {
    ChatQueryActor {
        user_id: actor.user_id,
        display_name: actor.display_name,
        email: actor.email,
        role: actor.role,
    }
}

fn internal_error(message: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(escalation_required: bool) -> CreateChatQuery {
        CreateChatQuery {
            session_id: Some("chat-1".to_string()),
            created_by: Some(ChatQueryActor {
                user_id: "business".to_string(),
                display_name: "Business User".to_string(),
                email: "business.user@livebook.com".to_string(),
                role: "business_user".to_string(),
            }),
            question: "Can we accept unlimited liability?".to_string(),
            answer: "Escalate this.".to_string(),
            clause_ref: "C01 Liability".to_string(),
            position_used: "fallback_2".to_string(),
            escalation_required,
            next_action: "Ask Legal Counsel.".to_string(),
        }
    }

    #[test]
    fn build_query_status_follows_escalation_flag() {
        let resolved = build_chat_query_item(input(false), "2026-04-25T12:00:00Z".to_string());
        let escalated = build_chat_query_item(input(true), "2026-04-25T12:00:01Z".to_string());

        assert_eq!(resolved.status, "resolved");
        assert_eq!(escalated.status, "escalated");
    }

    #[test]
    fn escalation_link_sets_escalated_status() {
        let mut query = build_chat_query_item(input(false), "2026-04-25T12:00:00Z".to_string());

        apply_escalation_link(&mut query, "ESC-1");

        assert_eq!(query.status, "escalated");
        assert_eq!(query.escalation_id, Some("ESC-1".to_string()));
    }

    #[test]
    fn review_status_records_lawyer_decision() {
        let mut query = build_chat_query_item(input(true), "2026-04-25T12:00:00Z".to_string());
        let reviewer = ChatQueryActor {
            user_id: "lawyer".to_string(),
            display_name: "Legal Counsel".to_string(),
            email: "legal.counsel@livebook.com".to_string(),
            role: "lawyer".to_string(),
        };

        apply_review_status(
            &mut query,
            "approved",
            reviewer,
            "2026-04-25T12:05:00Z".to_string(),
        );

        assert_eq!(query.status, "approved");
        assert_eq!(query.reviewed_at, Some("2026-04-25T12:05:00Z".to_string()));
        assert_eq!(
            query.reviewed_by.map(|actor| actor.display_name),
            Some("Legal Counsel".to_string())
        );
    }
}
