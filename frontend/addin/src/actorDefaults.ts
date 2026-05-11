import type { Audience } from "./types";

export interface LocalActor {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
}

const BUSINESS_ACTOR: LocalActor = {
  user_id: "word-addin-business-user",
  display_name: "Business User",
  email: "business.user@example.com",
  role: "business_user",
};

const LAWYER_ACTOR: LocalActor = {
  user_id: "word-addin-legal-counsel",
  display_name: "Legal Counsel",
  email: "legal.counsel@example.com",
  role: "lawyer",
};

export function actorForAudience(audience: Audience): LocalActor {
  return audience === "lawyer" ? LAWYER_ACTOR : BUSINESS_ACTOR;
}

export function defaultLawyer() {
  return LAWYER_ACTOR;
}
