pub mod chat_queries;
pub mod email;
pub mod escalation;
pub mod evolve;
pub mod playbook;
pub mod question;
pub mod tabular_review;

pub use chat_queries::get_chat_queries;
pub use email::{
    approve_email_queue, get_email_queue, ingest_email, reject_email_queue,
    run_email_processing_loop,
};
pub use escalation::{create_escalation, decline_escalation, get_escalations, resolve_escalation};
pub use evolve::{approve_evolve, get_evolve, reject_evolve, run_evolve_analysis};
pub use playbook::{
    approve_playbook_clause, confirm_playbook_upload_draft, decline_playbook_clause,
    explain_version_compare, get_clause_history, get_playbook, get_playbook_clause,
    get_playbook_history, get_playbook_review, get_playbook_version_detail, get_playbook_versions,
    get_playbooks, patch_playbook, patch_playbook_clause, post_playbook, restore_clause_version,
};
pub use question::{get_question, post_question};
pub use tabular_review::{
    apply_tabular_review_insights, get_tabular_review, get_tabular_reviews, post_tabular_review,
    post_tabular_review_text,
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::routes::playbook::post_playbook,
        crate::routes::playbook::patch_playbook,
        crate::routes::playbook::get_playbook,
        crate::routes::playbook::get_playbooks,
        crate::routes::playbook::get_playbook_versions,
        crate::routes::playbook::get_playbook_version_detail,
        crate::routes::playbook::get_playbook_clause,
        crate::routes::playbook::get_playbook_review,
        crate::routes::playbook::patch_playbook_clause,
        crate::routes::playbook::approve_playbook_clause,
        crate::routes::playbook::decline_playbook_clause,
        crate::routes::playbook::get_clause_history,
        crate::routes::playbook::explain_version_compare,
        crate::routes::playbook::restore_clause_version,
        crate::routes::playbook::confirm_playbook_upload_draft,
        crate::routes::playbook::get_playbook_history,
        crate::routes::chat_queries::get_chat_queries,
        crate::routes::question::get_question,
        crate::routes::question::post_question,
        crate::routes::evolve::get_evolve,
        crate::routes::evolve::approve_evolve,
        crate::routes::evolve::reject_evolve,
        crate::routes::email::ingest_email,
        crate::routes::email::get_email_queue,
        crate::routes::email::approve_email_queue,
        crate::routes::email::reject_email_queue,
        crate::routes::tabular_review::post_tabular_review,
        crate::routes::tabular_review::post_tabular_review_text,
        crate::routes::tabular_review::get_tabular_reviews,
        crate::routes::tabular_review::get_tabular_review,
        crate::routes::tabular_review::apply_tabular_review_insights,
        crate::routes::escalation::create_escalation,
        crate::routes::escalation::get_escalations,
        crate::routes::escalation::resolve_escalation,
        crate::routes::escalation::decline_escalation
    ),
    tags(
        (name = "Playbook", description = "Playbook ingestion and update endpoints"),
        (name = "Question", description = "Question answering and shared chat history endpoints"),
        (name = "Evolve", description = "Playbook evolution suggestions"),
        (name = "Email", description = "Email negotiation ingest and review queue"),
        (name = "Tabular Review", description = "Batch contract review against the current playbook"),
        (name = "Escalation", description = "Chat escalation review queue")
    )
)]
pub struct ApiDoc;
