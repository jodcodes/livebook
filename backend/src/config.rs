use std::{env, net::IpAddr, str::FromStr};

#[derive(Clone, Debug)]
pub struct ActorConfig {
    pub user_id: String,
    pub display_name: String,
    pub email: String,
    pub role: String,
}

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub database_url: String,
    pub backend_host: IpAddr,
    pub backend_port: u16,
    pub openai_api_key: Option<String>,
    pub openai_model: String,
    pub openai_embedding_model: String,
    pub openai_embedding_dimensions: usize,
    pub notification_mode: String,
    pub default_business_actor: ActorConfig,
    pub default_lawyer_actor: ActorConfig,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, String> {
        let database_url = env_required("DATABASE_URL")?;
        let backend_host = env::var("LIVEBOOK_BACKEND_HOST")
            .ok()
            .and_then(|raw| IpAddr::from_str(&raw).ok())
            .unwrap_or(IpAddr::from([0, 0, 0, 0]));
        let backend_port = env::var("LIVEBOOK_BACKEND_PORT")
            .ok()
            .and_then(|raw| raw.parse::<u16>().ok())
            .unwrap_or(5002);
        let openai_embedding_dimensions = env::var("OPENAI_EMBEDDING_DIMENSIONS")
            .ok()
            .and_then(|raw| raw.parse::<usize>().ok())
            .unwrap_or(1536);

        Ok(Self {
            database_url,
            backend_host,
            backend_port,
            openai_api_key: env::var("OPENAI_API_KEY")
                .ok()
                .filter(|value| !value.is_empty()),
            openai_model: env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.5".to_string()),
            openai_embedding_model: env::var("OPENAI_EMBEDDING_MODEL")
                .unwrap_or_else(|_| "text-embedding-3-small".to_string()),
            openai_embedding_dimensions,
            notification_mode: env::var("ESCALATION_NOTIFICATION_MODE")
                .unwrap_or_else(|_| "mocked".to_string()),
            default_business_actor: actor_from_env(
                "LIVEBOOK_DEFAULT_BUSINESS",
                "local-business-user",
                "Business User",
                "business.user@example.com",
                "business_user",
            ),
            default_lawyer_actor: actor_from_env(
                "LIVEBOOK_DEFAULT_LAWYER",
                "local-legal-counsel",
                "Legal Counsel",
                "legal.counsel@example.com",
                "lawyer",
            ),
        })
    }
}

fn env_required(name: &str) -> Result<String, String> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{name} must be set"))
}

fn actor_from_env(
    prefix: &str,
    default_user_id: &str,
    default_display_name: &str,
    default_email: &str,
    default_role: &str,
) -> ActorConfig {
    ActorConfig {
        user_id: env::var(format!("{prefix}_USER_ID"))
            .unwrap_or_else(|_| default_user_id.to_string()),
        display_name: env::var(format!("{prefix}_DISPLAY_NAME"))
            .unwrap_or_else(|_| default_display_name.to_string()),
        email: env::var(format!("{prefix}_EMAIL")).unwrap_or_else(|_| default_email.to_string()),
        role: env::var(format!("{prefix}_ROLE")).unwrap_or_else(|_| default_role.to_string()),
    }
}
