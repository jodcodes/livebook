mod auth;
mod config;
mod db;
mod repositories;
mod routes;
mod services;
use axum::{
    Router,
    routing::{get, post},
};
use config::AppConfig;
use db::Database;
use repositories::store;
use routes::{
    ApiDoc, apply_tabular_review_insights, approve_email_queue, approve_evolve,
    approve_playbook_clause, confirm_playbook_upload_draft, create_escalation, decline_escalation,
    decline_playbook_clause, explain_version_compare, get_chat_queries, get_clause_history,
    get_email_queue, get_escalations, get_evolve, get_playbook, get_playbook_clause,
    get_playbook_history, get_playbook_review, get_playbook_version_detail, get_playbook_versions,
    get_playbooks, get_tabular_review, get_tabular_reviews, ingest_email, patch_playbook,
    patch_playbook_clause, post_playbook, post_question, post_tabular_review,
    post_tabular_review_text, reject_email_queue, reject_evolve, resolve_escalation,
    restore_clause_version, run_email_processing_loop, run_evolve_analysis,
};
use std::net::SocketAddr;
use tracing::info;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

#[tokio::main]
async fn main() {
    let config = AppConfig::from_env().expect("failed to load application config");
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "backend=debug,tower_http=debug".to_string()),
        )
        .init();
    let database = Database::connect(&config)
        .await
        .expect("failed to connect to Postgres");
    store::init(config.clone(), database)
        .await
        .expect("failed to initialize repositories");

    tokio::spawn(run_email_processing_loop());
    tokio::spawn(async {
        let _ = run_evolve_analysis().await;
    });

    let app = Router::new()
        .route(
            "/playbook",
            get(get_playbook).post(post_playbook).patch(patch_playbook),
        )
        .route("/playbooks", get(get_playbooks))
        .route(
            "/playbooks/{playbook_id}/versions",
            get(get_playbook_versions),
        )
        .route(
            "/playbooks/{playbook_id}/versions/{version_id}",
            get(get_playbook_version_detail),
        )
        .route("/playbook/review", get(get_playbook_review))
        .route("/playbook/history", get(get_playbook_history))
        .route(
            "/playbook/{clause_id}",
            get(get_playbook_clause).patch(patch_playbook_clause),
        )
        .route(
            "/playbook/{clause_id}/approve",
            post(approve_playbook_clause),
        )
        .route(
            "/playbook/{clause_id}/decline",
            post(decline_playbook_clause),
        )
        .route("/playbook/{clause_id}/history", get(get_clause_history))
        .route(
            "/playbook/versions/compare/explain",
            post(explain_version_compare),
        )
        .route(
            "/playbook/{clause_id}/restore/{version}",
            post(restore_clause_version),
        )
        .route(
            "/playbook/uploads/{draft_id}/confirm",
            post(confirm_playbook_upload_draft),
        )
        .route("/question", get(routes::get_question).post(post_question))
        .route("/chat-queries", get(get_chat_queries))
        .route("/evolve", get(get_evolve))
        .route("/evolve/{id}/approve", post(approve_evolve))
        .route("/evolve/{id}/reject", post(reject_evolve))
        .route("/email/ingest", post(ingest_email))
        .route("/email/queue", get(get_email_queue))
        .route("/email/queue/{id}/approve", post(approve_email_queue))
        .route("/email/queue/{id}/reject", post(reject_email_queue))
        .route(
            "/tabular-review",
            get(get_tabular_reviews).post(post_tabular_review),
        )
        .route("/tabular-review/text", post(post_tabular_review_text))
        .route("/tabular-review/{session_id}", get(get_tabular_review))
        .route(
            "/tabular-review/{session_id}/apply-insights",
            post(apply_tabular_review_insights),
        )
        .route("/escalations", get(get_escalations).post(create_escalation))
        .route("/escalations/{id}/resolve", post(resolve_escalation))
        .route("/escalations/{id}/decline", post(decline_escalation))
        .merge(SwaggerUi::new("/swagger-ui").url("/api-doc/openapi.json", ApiDoc::openapi()));

    let addr = SocketAddr::from((config.backend_host, config.backend_port));
    info!("listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind TCP listener");
    axum::serve(listener, app).await.expect("server failed");
}
