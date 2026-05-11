use serde::{Deserialize, Serialize};

use crate::config::{ActorConfig, AppConfig};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ActorIdentity {
    pub user_id: String,
    pub display_name: String,
    pub email: String,
    pub role: String,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct RequestAuthContext {
    pub actor: ActorIdentity,
    pub source: String,
    pub session_id: Option<String>,
}

impl ActorIdentity {
    pub fn from_config(config: &ActorConfig) -> Self {
        Self {
            user_id: config.user_id.clone(),
            display_name: config.display_name.clone(),
            email: config.email.clone(),
            role: config.role.clone(),
        }
    }
}

pub fn default_actor_for_role(config: &AppConfig, role: &str) -> ActorIdentity {
    if role.eq_ignore_ascii_case("lawyer") || role.eq_ignore_ascii_case("legal") {
        ActorIdentity::from_config(&config.default_lawyer_actor)
    } else {
        ActorIdentity::from_config(&config.default_business_actor)
    }
}
