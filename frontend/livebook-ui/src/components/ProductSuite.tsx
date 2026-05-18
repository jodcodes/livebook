"use client";

import { type ChangeEvent, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { LegalTextPanel, PageHeader, Panel, StatusBadge, statusTone } from "@/components/premium";
import { createProductWorkflows, type ProductWorkflow, type WorkflowId } from "@/lib/productSuite";

type ResultState = {
  loading?: boolean;
  data?: unknown;
  error?: string;
};

type Activity = {
  id: string;
  label: string;
  detail: string;
};

type AuditEntry = {
  actor: string;
  action: string;
  final_text?: string | null;
};

type ReviewFinding = {
  id: string;
  severity: string;
  clause_ref: string;
  status: string;
  confidence: number;
  issue: string;
  comment: string;
  redline?: string | null;
  eligible_for_bulk: boolean;
  audit?: AuditEntry[];
};

type DraftResult = {
  content: string;
  assumptions: string[];
  sources: string[];
  library_matches?: Array<{
    id: string;
    title: string;
    clause_type: string;
    text: string;
    visibility: string;
    source: string;
  }>;
  review_notes?: string[];
  generation_mode?: string;
  model_error?: string | null;
  available_actions: string[];
};

type ChatAnswer = {
  answer: string;
  citations: string[];
  limited_by_missing_context: boolean;
  prompt_suggestions: string[];
  enhanced_prompt?: string | null;
  generation_mode?: string;
  model_error?: string | null;
};

type BenchmarkFinding = {
  id: string;
  deal_point: string;
  status: string;
  explanation: string;
  prevalence?: number | null;
  suggested_fix?: string | null;
  alternatives?: Array<{
    label: string;
    prevalence: number;
    text: string;
  }>;
  source_standard?: string;
  confidence?: string;
};

type BenchmarkReview = {
  matched_contract_type?: string | null;
  filters: string[];
  findings: BenchmarkFinding[];
  unavailable_reason?: string | null;
  dataset_version?: string;
};

type AgentProject = {
  project_id?: string;
  status?: string;
  task_plan: string[];
  suggestions: string[];
  open_issues: string[];
  next_actions: string[];
  document_summaries?: Array<{
    name: string;
    detected_parties: string[];
    detected_dates: string[];
    detected_defined_terms: string[];
  }>;
  proposed_updates?: Array<{
    id: string;
    target_documents: string[];
    change_type: string;
    current_value: string;
    suggested_value: string;
    approval_required: boolean;
  }>;
  completed_tasks?: string[];
  needs_clarification: boolean;
};

type SavedPanelKind = "reviews" | "precedents" | "standards" | "projects";

type ProofreadFinding = {
  id: string;
  kind: string;
  status: string;
  message: string;
  suggestion?: string | null;
  confidence: number;
};

const defaultMatterText =
  "This commercial lease has unlimited liability, no audit right, Section 99, FooBar shall comply, and [insert party]. Teh services are unclear.";
const defaultSelectedText = "Seller may terminate at any time.";

function confidenceLabel(value: number) {
  return `${Math.round(value * 100)}%`;
}

function EmptyResult({ label }: { label: string }) {
  return (
    <p className="rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
      {label}
    </p>
  );
}

function ResultActions({
  primary = "Stage change",
  onAction,
}: {
  primary?: string;
  onAction?: (label: string, detail: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => onAction?.("Edited", "Suggestion opened for lawyer edits.")}
      >
        <i className="ri-edit-line" data-icon="inline-start" />
        Edit
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={() => onAction?.(primary, "Change staged for document review.")}
      >
        <i className="ri-check-line" data-icon="inline-start" />
        {primary}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => onAction?.("Escalated", "Item added to legal review workflow.")}
      >
        <i className="ri-share-forward-line" data-icon="inline-start" />
        Escalate
      </Button>
    </div>
  );
}

function ReviewResult({
  data,
  onAction,
  onReviewAction,
  onBulkApply,
}: {
  data: unknown;
  onAction?: (label: string, detail: string) => void;
  onReviewAction?: (findingId: string, action: string, editedRedline?: string | null) => void;
  onBulkApply?: () => void;
}) {
  const session = data as { findings?: ReviewFinding[]; status?: string };
  const findings = session.findings ?? [];

  if (!findings.length) {
    return <EmptyResult label="No review findings yet." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone="accent">{session.status ?? "review ready"}</StatusBadge>
        <StatusBadge tone="neutral">{findings.length} findings</StatusBadge>
        <Button type="button" size="sm" variant="secondary" onClick={onBulkApply}>
          <i className="ri-check-double-line" data-icon="inline-start" />
          Bulk-apply high confidence
        </Button>
      </div>
      {findings.map((finding) => (
        <div key={finding.id} className="rounded-lg border bg-background p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">{finding.clause_ref}</p>
              <p className="mt-1 text-sm text-muted-foreground">{finding.issue}</p>
            </div>
            <div className="flex gap-2">
              <StatusBadge tone={statusTone(finding.severity)}>{finding.severity}</StatusBadge>
              <StatusBadge tone={finding.eligible_for_bulk ? "success" : "warning"}>
                {confidenceLabel(finding.confidence)}
              </StatusBadge>
            </div>
          </div>
          <LegalTextPanel className="mt-3">{finding.comment}</LegalTextPanel>
          {finding.redline ? (
            <LegalTextPanel className="mt-2 border-emerald-200 bg-emerald-50 text-emerald-950">
              {finding.redline}
            </LegalTextPanel>
          ) : null}
          {finding.audit?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {finding.audit.map((entry, index) => (
                <StatusBadge key={`${finding.id}-${entry.action}-${index}`} tone="neutral">
                  {entry.action} by {entry.actor}
                </StatusBadge>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onReviewAction?.(finding.id, "apply", finding.redline)}
            >
              <i className="ri-edit-line" data-icon="inline-start" />
              Apply redline
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onReviewAction?.(finding.id, "reject")}
            >
              <i className="ri-close-line" data-icon="inline-start" />
              Reject
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onAction?.("Edited", "Suggestion opened for lawyer edits.")}
            >
              <i className="ri-pencil-line" data-icon="inline-start" />
              Edit before apply
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function DraftResultView({ data, onAction }: { data: unknown; onAction?: (label: string, detail: string) => void }) {
  const draft = data as DraftResult;

  return (
    <div className="space-y-3">
      <LegalTextPanel className="border-emerald-200 bg-emerald-50 text-emerald-950">
        {draft.content}
      </LegalTextPanel>
      <div className="flex flex-wrap gap-2">
        {draft.generation_mode ? <StatusBadge tone="neutral">{draft.generation_mode}</StatusBadge> : null}
        {draft.model_error ? <StatusBadge tone="warning">AI fallback</StatusBadge> : null}
        {(draft.sources ?? []).map((source) => (
          <StatusBadge key={source} tone="info">{source}</StatusBadge>
        ))}
        {(draft.assumptions ?? []).map((assumption) => (
          <StatusBadge key={assumption} tone="warning">{assumption}</StatusBadge>
        ))}
      </div>
      {draft.library_matches?.length ? (
        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">Precedent library</p>
          {draft.library_matches.slice(0, 3).map((item) => (
            <div key={item.id} className="rounded-lg border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{item.title}</p>
                <StatusBadge tone="neutral">{item.visibility}</StatusBadge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.source}</p>
              <LegalTextPanel className="mt-2">{item.text}</LegalTextPanel>
            </div>
          ))}
        </div>
      ) : null}
      {draft.model_error ? <LegalTextPanel className="border-amber-200 bg-amber-50 text-amber-950">{draft.model_error}</LegalTextPanel> : null}
      {draft.review_notes?.length ? <ResultList title="Review gates" items={draft.review_notes} tone="warning" /> : null}
      <ResultActions primary="Insert into Word" onAction={onAction} />
    </div>
  );
}

function ChatResult({ data }: { data: unknown }) {
  const answer = data as ChatAnswer;

  return (
    <div className="space-y-3">
      <LegalTextPanel>{answer.answer}</LegalTextPanel>
      <div className="flex flex-wrap gap-2">
        {answer.generation_mode ? <StatusBadge tone="neutral">{answer.generation_mode}</StatusBadge> : null}
        {answer.model_error ? <StatusBadge tone="warning">AI fallback</StatusBadge> : null}
        {(answer.citations ?? []).map((citation) => (
          <StatusBadge key={citation} tone="accent">{citation}</StatusBadge>
        ))}
        {answer.limited_by_missing_context ? <StatusBadge tone="warning">limited context</StatusBadge> : null}
      </div>
      {answer.model_error ? <LegalTextPanel className="border-amber-200 bg-amber-50 text-amber-950">{answer.model_error}</LegalTextPanel> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {(answer.prompt_suggestions ?? []).slice(0, 4).map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="rounded-lg border bg-background px-3 py-2 text-left text-sm hover:bg-muted"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function BenchmarkResult({ data, onAction }: { data: unknown; onAction?: (label: string, detail: string) => void }) {
  const review = data as BenchmarkReview;

  if (review.unavailable_reason) {
    return <EmptyResult label={review.unavailable_reason} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone="accent">{review.matched_contract_type ?? "matched standard"}</StatusBadge>
        {review.dataset_version ? <StatusBadge tone="info">{review.dataset_version}</StatusBadge> : null}
        {(review.filters ?? []).map((filter) => (
          <StatusBadge key={filter} tone="neutral">{filter}</StatusBadge>
        ))}
      </div>
      {(review.findings ?? []).map((finding) => (
        <div key={finding.id} className="rounded-lg border bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{finding.deal_point}</p>
            <div className="flex gap-2">
              <StatusBadge tone={statusTone(finding.status)}>{finding.status}</StatusBadge>
              {finding.prevalence ? <StatusBadge tone="info">{finding.prevalence}% market</StatusBadge> : null}
              {finding.confidence ? <StatusBadge tone="neutral">{finding.confidence}</StatusBadge> : null}
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{finding.explanation}</p>
          {finding.source_standard ? (
            <p className="mt-1 text-xs text-muted-foreground">Standard: {finding.source_standard}</p>
          ) : null}
          {finding.alternatives?.length ? (
            <div className="mt-3 grid gap-2">
              {finding.alternatives.map((alternative) => (
                <div key={alternative.label} className="rounded-md border bg-muted/30 p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{alternative.label}</span>
                    <StatusBadge tone="info">{alternative.prevalence}%</StatusBadge>
                  </div>
                  <p className="mt-1 text-muted-foreground">{alternative.text}</p>
                </div>
              ))}
            </div>
          ) : null}
          {finding.suggested_fix ? (
            <LegalTextPanel className="mt-3 border-emerald-200 bg-emerald-50 text-emerald-950">
              {finding.suggested_fix}
            </LegalTextPanel>
          ) : null}
          <ResultActions primary="Stage redline" onAction={onAction} />
        </div>
      ))}
    </div>
  );
}

function AssociateResult({ data }: { data: unknown }) {
  const project = data as AgentProject;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="flex flex-wrap gap-2 md:col-span-2">
        {project.project_id ? <StatusBadge tone="neutral">{project.project_id}</StatusBadge> : null}
        {project.status ? <StatusBadge tone={project.needs_clarification ? "warning" : "success"}>{project.status}</StatusBadge> : null}
      </div>
      <ResultList title="Task plan" items={project.task_plan} tone="accent" />
      <ResultList title="Open issues" items={project.open_issues} tone={project.needs_clarification ? "warning" : "danger"} />
      <ResultList title="Suggested updates" items={project.suggestions} tone="info" />
      <ResultList title="Next actions" items={project.next_actions} tone="success" />
      <ResultList title="Completed tasks" items={project.completed_tasks} tone="success" />
      {project.document_summaries?.length ? (
        <div className="rounded-lg border bg-background p-3">
          <div className="mb-2 flex items-center gap-2">
            <StatusBadge tone="neutral">Document map</StatusBadge>
          </div>
          <div className="space-y-2">
            {project.document_summaries.map((doc) => (
              <div key={doc.name} className="rounded-md border bg-muted/30 p-2 text-sm">
                <p className="font-medium">{doc.name}</p>
                <p className="text-muted-foreground">
                  Parties: {doc.detected_parties.join(", ") || "none"} · Dates:{" "}
                  {doc.detected_dates.join(", ") || "none"}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {project.proposed_updates?.length ? (
        <div className="rounded-lg border bg-background p-3 md:col-span-2">
          <div className="mb-2 flex items-center gap-2">
            <StatusBadge tone="warning">Approval-required updates</StatusBadge>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {project.proposed_updates.map((update) => (
              <div key={update.id} className="rounded-md border bg-muted/30 p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{update.change_type.replaceAll("_", " ")}</p>
                  <StatusBadge tone={update.approval_required ? "warning" : "success"}>
                    {update.approval_required ? "approval required" : "ready"}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-muted-foreground">{update.current_value}</p>
                <LegalTextPanel className="mt-2">{update.suggested_value}</LegalTextPanel>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProofreadResult({ data, onAction }: { data: unknown; onAction?: (label: string, detail: string) => void }) {
  const findings = data as ProofreadFinding[];

  if (!findings.length) {
    return <EmptyResult label="No proofread issues found." />;
  }

  return (
    <div className="space-y-3">
      {findings.map((finding) => (
        <div key={finding.id} className="rounded-lg border bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{finding.message}</p>
            <div className="flex gap-2">
              <StatusBadge tone="neutral">{finding.kind.replaceAll("_", " ")}</StatusBadge>
              <StatusBadge tone="info">{confidenceLabel(finding.confidence)}</StatusBadge>
            </div>
          </div>
          {finding.suggestion ? <LegalTextPanel className="mt-3">{finding.suggestion}</LegalTextPanel> : null}
          <ResultActions primary="Apply fix" onAction={onAction} />
        </div>
      ))}
    </div>
  );
}

function ResultList({
  title,
  items,
  tone,
}: {
  title: string;
  items?: string[];
  tone: "accent" | "info" | "success" | "warning" | "danger";
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="mb-2 flex items-center gap-2">
        <StatusBadge tone={tone}>{title}</StatusBadge>
      </div>
      <ul className="space-y-2 text-sm text-muted-foreground">
        {(items?.length ? items : ["No items."]).map((item) => (
          <li key={item} className="flex gap-2">
            <i className="ri-checkbox-blank-circle-line mt-0.5 text-xs text-livebook" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function arrayFromPayload(data: unknown, key: string) {
  const value = data as Record<string, unknown> | undefined;
  return Array.isArray(value?.[key]) ? (value[key] as Array<Record<string, unknown>>) : [];
}

function textField(item: Record<string, unknown>, key: string, fallback = "") {
  const value = item[key];
  return typeof value === "string" ? value : fallback;
}

function SavedDataPanel({ kind, state }: { kind: SavedPanelKind; state?: ResultState }) {
  if (state?.loading) {
    return <EmptyResult label="Loading saved product data." />;
  }
  if (state?.error) {
    return <LegalTextPanel className="border-red-200 bg-red-50 text-red-900">{state.error}</LegalTextPanel>;
  }
  if (!state?.data) {
    return null;
  }

  const config = {
    reviews: { title: "Saved reviews", key: "sessions", empty: "No saved Word reviews yet." },
    precedents: { title: "Precedent library", key: "documents", empty: "No imported precedents yet." },
    standards: { title: "Benchmark standards", key: "standards", empty: "No saved benchmark standards yet." },
    projects: { title: "Associate projects", key: "projects", empty: "No saved associate projects yet." },
  }[kind];
  const items = arrayFromPayload(state.data, config.key);

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{config.title}</span>
        <StatusBadge tone="neutral">{items.length} saved</StatusBadge>
      </div>
      {items.length ? (
        <div className="space-y-2">
          {items.slice(0, 5).map((item, index) => {
            const title =
              textField(item, "title") ||
              textField(item, "name") ||
              textField(item, "project_id") ||
              textField(item, "session_id") ||
              `${config.title} ${index + 1}`;
            const detail =
              textField(item, "status") ||
              textField(item, "visibility") ||
              textField(item, "contract_type") ||
              textField(item, "dataset_version", "saved");
            return (
              <div key={`${kind}-${title}-${index}`} className="rounded-lg border bg-background p-2 text-sm">
                <p className="font-medium">{title}</p>
                <p className="text-muted-foreground">{detail}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyResult label={config.empty} />
      )}
    </div>
  );
}

function WorkflowResult({
  workflowId,
  state,
  onAction,
  onReviewAction,
  onBulkApply,
}: {
  workflowId: WorkflowId;
  state?: ResultState;
  onAction?: (label: string, detail: string) => void;
  onReviewAction?: (findingId: string, action: string, editedRedline?: string | null) => void;
  onBulkApply?: () => void;
}) {
  if (state?.error) {
    return <LegalTextPanel className="border-red-200 bg-red-50 text-red-900">{state.error}</LegalTextPanel>;
  }

  if (!state?.data) {
    return <EmptyResult label="Run this workspace action against the current matter context." />;
  }

  switch (workflowId) {
    case "word-review":
      return (
        <ReviewResult
          data={state.data}
          onAction={onAction}
          onReviewAction={onReviewAction}
          onBulkApply={onBulkApply}
        />
      );
    case "draft-clause":
      return <DraftResultView data={state.data} onAction={onAction} />;
    case "document-chat":
      return <ChatResult data={state.data} />;
    case "benchmark-review":
      return <BenchmarkResult data={state.data} onAction={onAction} />;
    case "associate-project":
      return <AssociateResult data={state.data} />;
    case "proofread":
      return <ProofreadResult data={state.data} onAction={onAction} />;
  }
}

export default function ProductSuite({ activeWorkflowId }: { activeWorkflowId?: WorkflowId }) {
  const [documentText, setDocumentText] = useState(defaultMatterText);
  const [draftInstructions, setDraftInstructions] = useState("Draft an indemnity clause");
  const [goal, setGoal] = useState("Review consistency across financing documents");
  const [question, setQuestion] = useState("make it more buyer-friendly");
  const [selectedText, setSelectedText] = useState(defaultSelectedText);
  const [standardsAvailable, setStandardsAvailable] = useState(true);
  const [precedentTitle, setPrecedentTitle] = useState("Customer precedent");
  const [precedentText, setPrecedentText] = useState(
    "Supplier shall defend and indemnify Customer from third-party intellectual property claims arising from the Services.\n\nEach party shall protect Confidential Information using reasonable care and use it only to perform this agreement."
  );
  const [benchmarkName, setBenchmarkName] = useState("Team software MSA standard");
  const [benchmarkContractType, setBenchmarkContractType] = useState("master services agreement");
  const [benchmarkLiabilityFix, setBenchmarkLiabilityFix] = useState(
    "Add a liability cap at 12 months of fees with carveouts for confidentiality, data security, and IP indemnity."
  );
  const [benchmarkAuditFix, setBenchmarkAuditFix] = useState(
    "Add an annual audit right on reasonable notice with confidentiality safeguards."
  );
  const [results, setResults] = useState<Record<WorkflowId, ResultState>>({} as Record<WorkflowId, ResultState>);
  const [savedData, setSavedData] = useState<Record<SavedPanelKind, ResultState>>({} as Record<SavedPanelKind, ResultState>);
  const [activity, setActivity] = useState<Activity[]>([]);

  const workflows = useMemo(
    () =>
      createProductWorkflows({
        documentText,
        draftInstructions,
        goal,
        question,
        selectedText,
        standardsAvailable,
        benchmarkContractType,
      }),
    [documentText, draftInstructions, goal, question, selectedText, standardsAvailable, benchmarkContractType]
  );
  const activeWorkflow = workflows.find((workflow) => workflow.id === activeWorkflowId);
  const visibleWorkflows = activeWorkflow ? [activeWorkflow] : workflows;

  const runWorkflow = async (workflow: ProductWorkflow) => {
    setResults((current) => ({
      ...current,
      [workflow.id]: { loading: true },
    }));

    try {
      const response = await fetch(`/api/product/${workflow.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(workflow.payload()),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error ?? `Workflow failed with ${response.status}`);
      }

      setResults((current) => ({
        ...current,
        [workflow.id]: { data },
      }));
      recordActivity(workflow.title, `${workflow.actionLabel} completed.`);
    } catch (error) {
      setResults((current) => ({
        ...current,
        [workflow.id]: { error: error instanceof Error ? error.message : String(error) },
      }));
    }
  };

  const recordActivity = (label: string, detail: string) => {
    setActivity((current) => [
      {
        id: `${Date.now()}-${label}`,
        label,
        detail,
      },
      ...current,
    ].slice(0, 6));
  };

  const postProductAction = async (workflow: string, payload: Record<string, unknown>) => {
    const response = await fetch(`/api/product/${workflow}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error ?? `Action failed with ${response.status}`);
    }
    return data;
  };

  const loadSaved = async (kind: SavedPanelKind, workflow: string, payload: Record<string, unknown> = {}) => {
    setSavedData((current) => ({ ...current, [kind]: { loading: true } }));
    try {
      const data = await postProductAction(workflow, payload);
      setSavedData((current) => ({ ...current, [kind]: { data } }));
      recordActivity("Saved data loaded", kind);
    } catch (error) {
      setSavedData((current) => ({
        ...current,
        [kind]: { error: error instanceof Error ? error.message : String(error) },
      }));
    }
  };

  const applyReviewAction = async (findingId: string, action: string, editedRedline?: string | null) => {
    const session = results["word-review"]?.data;
    if (!session) {
      recordActivity("Review action unavailable", "Run Word Review before applying a finding.");
      return;
    }
    try {
      const data = await postProductAction("word-review-action", {
        session,
        finding_id: findingId,
        actor: "Legal Reviewer",
        action,
        edited_redline: editedRedline,
      });
      setResults((current) => ({ ...current, "word-review": { data } }));
      recordActivity("Review action saved", `${action} ${findingId}`);
      await loadSaved("reviews", "word-review-list");
    } catch (error) {
      recordActivity("Review action failed", error instanceof Error ? error.message : String(error));
    }
  };

  const bulkApplyReview = async () => {
    const session = results["word-review"]?.data;
    if (!session) {
      recordActivity("Bulk apply unavailable", "Run Word Review before bulk applying findings.");
      return;
    }
    try {
      const data = await postProductAction("word-review-bulk-apply", {
        session,
        actor: "Legal Reviewer",
      });
      setResults((current) => ({ ...current, "word-review": { data: data.session } }));
      recordActivity("Bulk apply saved", `${data.summary?.applied ?? 0} findings applied.`);
      await loadSaved("reviews", "word-review-list");
    } catch (error) {
      recordActivity("Bulk apply failed", error instanceof Error ? error.message : String(error));
    }
  };

  const importPrecedent = async () => {
    try {
      const data = await postProductAction("precedents-upload", {
        title: precedentTitle,
        text: precedentText,
        visibility: "team",
      });
      recordActivity(
        "Precedent imported",
        `${data.imported_clauses?.length ?? 0} clauses saved to the library.`
      );
      await loadSaved("precedents", "precedents-list");
    } catch (error) {
      recordActivity("Precedent import failed", error instanceof Error ? error.message : String(error));
    }
  };

  const importPrecedentFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", precedentTitle || file.name);
      formData.append("visibility", "team");
      const response = await fetch("/api/product/precedents-upload-file", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? `Upload failed with ${response.status}`);
      }
      recordActivity(
        "Precedent file imported",
        `${data.imported_clauses?.length ?? 0} clauses saved from ${file.name}.`
      );
      await loadSaved("precedents", "precedents-list");
    } catch (error) {
      recordActivity("Precedent file failed", error instanceof Error ? error.message : String(error));
    } finally {
      event.target.value = "";
    }
  };

  const saveBenchmarkStandard = async () => {
    try {
      const data = await postProductAction("benchmark-standards-save", {
        name: benchmarkName,
        contract_type: benchmarkContractType,
        visibility: "team",
        liability_fix: benchmarkLiabilityFix,
        audit_fix: benchmarkAuditFix,
      });
      recordActivity("Benchmark standard saved", data.name ?? benchmarkName);
      await loadSaved("standards", "benchmark-standards-list");
    } catch (error) {
      recordActivity("Benchmark save failed", error instanceof Error ? error.message : String(error));
    }
  };

  const contextDescription =
    activeWorkflowId === "draft-clause"
      ? "Draft from instructions and current matter context."
      : activeWorkflowId === "document-chat"
        ? "Ask against selected text, the active document, and playbook guidance."
        : activeWorkflowId === "associate-project"
          ? "Plan work across the current document set."
            : "Use the active matter text for this workflow.";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <PageHeader
        eyebrow="Contract intelligence"
        title={activeWorkflow?.title ?? "Review, draft, benchmark, and proofread"}
        description={
          activeWorkflow?.description ??
          "Work directly from the current matter context. Livebook stages legal changes for review instead of applying AI output silently."
        }
        meta={
          <>
            <StatusBadge tone="accent">Word review</StatusBadge>
            <StatusBadge tone="info">Drafting</StatusBadge>
            <StatusBadge tone="warning">Market</StatusBadge>
            <StatusBadge tone="neutral">Associate</StatusBadge>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(300px,380px)_1fr] gap-4 overflow-hidden p-5 max-lg:grid-cols-1 max-lg:overflow-auto">
        <Panel title={activeWorkflow?.title ?? "Current matter context"} description={contextDescription}>
          <div className="space-y-4">
            {activeWorkflowId === "draft-clause" ? (
              <>
                <label className="block space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">Drafting instructions</span>
                  <Textarea
                    value={draftInstructions}
                    onChange={(event) => setDraftInstructions(event.target.value)}
                    className="min-h-28 resize-none"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">Matter context</span>
                  <Textarea
                    value={documentText}
                    onChange={(event) => setDocumentText(event.target.value)}
                    className="min-h-40 resize-none"
                  />
                </label>
                <div className="space-y-3 border-t pt-4">
                  <span className="text-xs font-medium text-muted-foreground">Precedent import</span>
                  <input
                    value={precedentTitle}
                    onChange={(event) => setPrecedentTitle(event.target.value)}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    aria-label="Precedent title"
                  />
                  <Textarea
                    value={precedentText}
                    onChange={(event) => setPrecedentText(event.target.value)}
                    className="min-h-32 resize-none"
                    aria-label="Precedent text"
                  />
                  <Button type="button" variant="secondary" className="w-full justify-start" onClick={importPrecedent}>
                    <i className="ri-upload-cloud-line" data-icon="inline-start" />
                    Import precedent to library
                  </Button>
                  <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm hover:bg-muted">
                    <i className="ri-file-upload-line" data-icon="inline-start" />
                    Upload PDF/DOCX/TXT precedent
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt,.md"
                      className="hidden"
                      onChange={importPrecedentFile}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => loadSaved("precedents", "precedents-list")}
                  >
                    <i className="ri-folder-open-line" data-icon="inline-start" />
                    Load saved precedents
                  </Button>
                </div>
                <SavedDataPanel kind="precedents" state={savedData.precedents} />
              </>
            ) : null}

            {activeWorkflowId === "document-chat" ? (
              <>
                <label className="block space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">Question</span>
                  <Textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    className="min-h-24 resize-none"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">Selected text</span>
                  <Textarea
                    value={selectedText}
                    onChange={(event) => setSelectedText(event.target.value)}
                    className="min-h-28 resize-none"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">Document context</span>
                  <Textarea
                    value={documentText}
                    onChange={(event) => setDocumentText(event.target.value)}
                    className="min-h-32 resize-none"
                  />
                </label>
              </>
            ) : null}

            {activeWorkflowId === "associate-project" ? (
              <>
                <label className="block space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">Project goal</span>
                  <Textarea
                    value={goal}
                    onChange={(event) => setGoal(event.target.value)}
                    className="min-h-28 resize-none"
                  />
                </label>
                <div className="space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">Document set</span>
                  <LegalTextPanel>Credit Agreement: Party Acme Inc. Closing Date May 1.</LegalTextPanel>
                  <LegalTextPanel>Security Agreement: Party ACME Incorporated. Closing Date May 2.</LegalTextPanel>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => loadSaved("projects", "associate-project-list")}
                >
                  <i className="ri-history-line" data-icon="inline-start" />
                  Load saved projects
                </Button>
                <SavedDataPanel kind="projects" state={savedData.projects} />
              </>
            ) : null}

            {activeWorkflowId === "word-review" ||
            activeWorkflowId === "benchmark-review" ||
            activeWorkflowId === "proofread" ||
            !activeWorkflowId ? (
              <>
                <label className="block space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">Document text</span>
                  <Textarea
                    value={documentText}
                    onChange={(event) => setDocumentText(event.target.value)}
                    className="min-h-52 resize-none"
                  />
                </label>
                {activeWorkflowId === "benchmark-review" ? (
                  <div className="space-y-3 border-t pt-4">
                    <Button
                      type="button"
                      variant={standardsAvailable ? "default" : "secondary"}
                      onClick={() => setStandardsAvailable((current) => !current)}
                      className="w-full justify-start"
                    >
                      <i className={standardsAvailable ? "ri-checkbox-circle-line" : "ri-close-circle-line"} data-icon="inline-start" />
                      {standardsAvailable ? "Market standards available" : "No market standard available"}
                    </Button>
                    <span className="text-xs font-medium text-muted-foreground">Custom benchmark standard</span>
                    <input
                      value={benchmarkContractType}
                      onChange={(event) => setBenchmarkContractType(event.target.value)}
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      aria-label="Benchmark contract type"
                    />
                    <input
                      value={benchmarkName}
                      onChange={(event) => setBenchmarkName(event.target.value)}
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      aria-label="Benchmark standard name"
                    />
                    <Textarea
                      value={benchmarkLiabilityFix}
                      onChange={(event) => setBenchmarkLiabilityFix(event.target.value)}
                      className="min-h-20 resize-none"
                      aria-label="Benchmark liability fix"
                    />
                    <Textarea
                      value={benchmarkAuditFix}
                      onChange={(event) => setBenchmarkAuditFix(event.target.value)}
                      className="min-h-20 resize-none"
                      aria-label="Benchmark audit fix"
                    />
                    <Button type="button" variant="secondary" className="w-full justify-start" onClick={saveBenchmarkStandard}>
                      <i className="ri-save-line" data-icon="inline-start" />
                      Save custom standard
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => loadSaved("standards", "benchmark-standards-list")}
                    >
                      <i className="ri-list-check-3" data-icon="inline-start" />
                      Load benchmark standards
                    </Button>
                  </div>
                ) : null}
                {activeWorkflowId === "word-review" ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => loadSaved("reviews", "word-review-list")}
                    >
                      <i className="ri-history-line" data-icon="inline-start" />
                      Load saved reviews
                    </Button>
                    <SavedDataPanel kind="reviews" state={savedData.reviews} />
                  </>
                ) : null}
                {activeWorkflowId === "benchmark-review" ? (
                  <SavedDataPanel kind="standards" state={savedData.standards} />
                ) : null}
              </>
            ) : null}

            {activity.length ? (
              <div className="space-y-2 border-t pt-4">
                <span className="text-xs font-medium text-muted-foreground">Recent activity</span>
                <div className="space-y-2">
                  {activity.map((item) => (
                    <div key={item.id} className="rounded-lg border bg-background p-2 text-sm">
                      <p className="font-medium">{item.label}</p>
                      <p className="text-muted-foreground">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Panel>

        <div className="min-h-0 overflow-auto">
          <div className="grid gap-4 xl:grid-cols-2">
            {visibleWorkflows.map((workflow) => {
              const result = results[workflow.id];

              return (
                <Card key={workflow.id} className="border-border/80 bg-card shadow-none">
                  <CardHeader className="border-b">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-livebook">
                          <i className={workflow.iconClass} />
                        </div>
                        <div className="min-w-0">
                          <CardTitle>{workflow.title}</CardTitle>
                          <CardDescription className="mt-1">{workflow.description}</CardDescription>
                        </div>
                      </div>
                      <Button
                        type="button"
                        onClick={() => runWorkflow(workflow)}
                        disabled={result?.loading}
                        className="shrink-0"
                      >
                        <i className="ri-play-line" data-icon="inline-start" />
                        {result?.loading ? "Working" : workflow.actionLabel}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4">
                    <WorkflowResult
                      workflowId={workflow.id}
                      state={result}
                      onAction={recordActivity}
                      onReviewAction={applyReviewAction}
                      onBulkApply={bulkApplyReview}
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
