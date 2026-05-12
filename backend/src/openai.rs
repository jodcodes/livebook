use axum::http::StatusCode;

pub const OPENAI_API_KEY_MISSING_MESSAGE: &str = "OPENAI_API_KEY is not configured";

pub fn missing_api_key_error() -> (StatusCode, String) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        OPENAI_API_KEY_MISSING_MESSAGE.to_string(),
    )
}
