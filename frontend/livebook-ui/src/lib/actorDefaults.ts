export type LocalActorRole = "business" | "lawyer";

export interface LocalActor {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
}

const businessActor: LocalActor = {
  user_id:
    process.env.NEXT_PUBLIC_LIVEBOOK_DEFAULT_BUSINESS_USER_ID ?? "local-business-user",
  display_name:
    process.env.NEXT_PUBLIC_LIVEBOOK_DEFAULT_BUSINESS_DISPLAY_NAME ?? "Business User",
  email:
    process.env.NEXT_PUBLIC_LIVEBOOK_DEFAULT_BUSINESS_EMAIL ??
    "business.user@example.com",
  role: process.env.NEXT_PUBLIC_LIVEBOOK_DEFAULT_BUSINESS_ROLE ?? "business_user",
};

const lawyerActor: LocalActor = {
  user_id:
    process.env.NEXT_PUBLIC_LIVEBOOK_DEFAULT_LAWYER_USER_ID ?? "local-legal-counsel",
  display_name:
    process.env.NEXT_PUBLIC_LIVEBOOK_DEFAULT_LAWYER_DISPLAY_NAME ?? "Legal Counsel",
  email:
    process.env.NEXT_PUBLIC_LIVEBOOK_DEFAULT_LAWYER_EMAIL ??
    "legal.counsel@example.com",
  role: process.env.NEXT_PUBLIC_LIVEBOOK_DEFAULT_LAWYER_ROLE ?? "lawyer",
};

export function localActor(role: LocalActorRole): LocalActor {
  return role === "lawyer" ? lawyerActor : businessActor;
}

export function localReviewer() {
  return localActor("lawyer");
}
