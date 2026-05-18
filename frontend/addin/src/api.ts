import type {
  Audience,
  ChatTurn,
  CreateEscalationResponse,
  PlaybookClause,
  ProductReviewSession,
  QuestionResponse,
  TabularReviewSession,
} from "./types";
import { actorForAudience, defaultLawyer } from "./actorDefaults";

declare const __LIVEBOOK_API_URL__: string;

const API_BASE = __LIVEBOOK_API_URL__.replace(/\/$/, "");

function url(path: string) {
  return API_BASE ? `${API_BASE}${path}` : `/api${path}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

interface BackendQuestionAnswer {
  answer: string;
  clause_ref: string;
  position_used: string;
  escalation_required: boolean;
  next_action: string;
  suggested_clause?: string | null;
}

export async function askLivebook(input: {
  question: string;
  audience: Audience;
  history: ChatTurn[];
}): Promise<QuestionResponse> {
  const actor = actorForAudience(input.audience);
  const audienceContext =
    input.audience === "lawyer"
      ? "\n\nAnswer for a lawyer and make the grounding auditable."
      : "\n\nAnswer in plain language for a business user.";
  const answer = await requestJson<BackendQuestionAnswer>("/question", {
    method: "POST",
    body: JSON.stringify({
      q: `${input.question}${audienceContext}`,
      history: input.history,
      created_by: actor,
    }),
  });

  return {
    answer: answer.answer,
    grounding: [
      `Clause: ${answer.clause_ref}`,
      `Position used: ${answer.position_used}`,
    ],
    suggestedClause: answer.suggested_clause ?? null,
    clauseRef: answer.clause_ref,
    positionUsed: answer.position_used,
    escalationRequired: answer.escalation_required,
    nextAction: answer.next_action,
  };
}

export async function createEscalation(input: {
  question: string;
  answer: QuestionResponse;
  reason: string;
}): Promise<CreateEscalationResponse> {
  const createdBy = actorForAudience("business");
  const lawyer = defaultLawyer();
  return requestJson<CreateEscalationResponse>("/escalations", {
    method: "POST",
    body: JSON.stringify({
      created_by: createdBy,
      created_from: {
        source: "word_addin",
        session_id: `word-addin-${new Date().toISOString().slice(0, 10)}`,
        message_id: String(Date.now()),
      },
      lawyer: {
        user_id: lawyer.user_id,
        display_name: lawyer.display_name,
        email: lawyer.email,
      },
      question: input.question,
      answer: input.answer.answer,
      clause_ref: input.answer.clauseRef ?? "Unknown clause",
      position_used: input.answer.positionUsed ?? "preferred",
      escalation_reason: input.reason || input.answer.nextAction || "Review Word add-in answer.",
      next_action: input.answer.nextAction ?? "Review escalation before responding.",
    }),
  });
}

export async function listReviewSessions(): Promise<TabularReviewSession[]> {
  return requestJson<TabularReviewSession[]>("/tabular-review");
}

export async function reviewContractText(input: {
  contractText: string;
  fileName: string;
}): Promise<TabularReviewSession> {
  return requestJson<TabularReviewSession>("/tabular-review/text", {
    method: "POST",
    body: JSON.stringify({
      contract_text: input.contractText,
      file_name: input.fileName,
    }),
  });
}

export async function reviewWordProduct(input: {
  documentText: string;
  actor: string;
  wordContextAvailable: boolean;
}): Promise<ProductReviewSession> {
  return requestJson<ProductReviewSession>("/product/word-review", {
    method: "POST",
    body: JSON.stringify({
      document_text: input.documentText,
      actor: input.actor,
      word_context_available: input.wordContextAvailable,
    }),
  });
}

export async function loadPlaybookClause(clauseId: string): Promise<PlaybookClause> {
  return requestJson<PlaybookClause>(`/playbook/${encodeURIComponent(clauseId)}`);
}
