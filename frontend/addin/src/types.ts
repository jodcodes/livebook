export type Audience = "business" | "lawyer";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface QuestionResponse {
  answer: string;
  grounding: string[];
  suggestedClause: string | null;
  clauseRef?: string;
  positionUsed?: string;
  escalationRequired?: boolean;
  nextAction?: string;
}

export interface PlaybookClause {
  clause_id: string;
  original_clause_id?: string;
  name: string;
  clause_type?: string;
  law_type?: string;
  playbook_id?: string;
  playbook_name?: string;
  party_name?: string;
  positions?: {
    preferred?: string;
    fallback_1?: string;
    fallback_2?: string;
  };
  red_line?: string;
  escalation_trigger?: string;
  always_escalate?: boolean;
  keywords?: string[];
  raw_source_segment?: string;
  meta?: {
    version?: number;
    review_status?: string;
  };
}

export interface TabularReviewSession {
  session_id: string;
  created_at: string;
  status: string;
  uploaded_by_role?: "business" | "lawyer";
  escalation_id?: string | null;
  playbook_hash: string;
  playbook_clause_count: number;
  contracts: TabularReviewContract[];
  rows: TabularReviewRow[];
  metrics: TabularReviewMetrics;
  applied_at?: string | null;
}

export interface TabularReviewContract {
  contract_id: string;
  file_name: string;
  counterparty: string;
  matched_clause_count: number;
}

export interface TabularReviewRow {
  row_id: string;
  contract_id: string;
  file_name: string;
  counterparty: string;
  clause_id: string;
  clause_name: string;
  playbook_version: number;
  clause_type: string;
  outcome: "preferred" | "fallback_1" | "fallback_2" | "red_line_breached";
  deviation_score: number;
  confidence: "low" | "medium" | "high";
  evidence: string;
  rationale: string;
  applied: boolean;
}

export interface TabularReviewMetrics {
  contract_count: number;
  matched_clause_count: number;
  average_deviation: number;
  red_line_breaches: number;
  fallback_rows: number;
}

export interface ProductReviewFinding {
  id: string;
  severity: string;
  clause_ref: string;
  status: string;
  confidence: number;
  issue: string;
  source: string;
  comment: string;
  redline?: string | null;
  eligible_for_bulk: boolean;
}

export interface ProductReviewSession {
  session_id: string;
  status: string;
  findings: ProductReviewFinding[];
}

export interface ClauseLibraryItem {
  id: string;
  title: string;
  clause_type: string;
  text: string;
  visibility: string;
  source: string;
}

export interface DraftResult {
  content: string;
  assumptions: string[];
  sources: string[];
  library_matches: ClauseLibraryItem[];
  review_notes: string[];
  generation_mode: string;
  model_error?: string | null;
  available_actions: string[];
}

export interface DocumentSummary {
  name: string;
  detected_parties: string[];
  detected_dates: string[];
  detected_defined_terms: string[];
}

export interface ProjectUpdate {
  id: string;
  target_documents: string[];
  change_type: string;
  current_value: string;
  suggested_value: string;
  approval_required: boolean;
}

export interface AgentProject {
  project_id: string;
  status: string;
  task_plan: string[];
  suggestions: string[];
  open_issues: string[];
  next_actions: string[];
  document_summaries: DocumentSummary[];
  proposed_updates: ProjectUpdate[];
  completed_tasks: string[];
  needs_clarification: boolean;
}

export interface ProofreadFinding {
  id: string;
  kind: string;
  status: string;
  message: string;
  suggestion?: string | null;
  confidence: number;
}

export interface CreateEscalationResponse {
  item: {
    id: string;
    status: string;
  };
  notification_result?: {
    status?: string;
  };
}
