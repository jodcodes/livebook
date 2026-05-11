"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { localReviewer } from "@/lib/actorDefaults";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LegalTextPanel, MetricTile, Notice, PremiumEmpty, StatusBadge, statusTone } from "@/components/premium";
import { cn } from "@/lib/utils";

const API_BASE = "/api/backend";

interface ReviewClause {
  clause_id: string;
  original_clause_id?: string;
  name: string;
  playbook_id?: string;
  playbook_name?: string;
  playbook_type?: string;
  party_name?: string;
  law_type?: string;
  clause_type?: string;
  source_files?: string[];
  positions?: Record<string, string>;
  red_line?: string;
  escalation_trigger?: string;
  always_escalate?: boolean;
  keywords?: string[];
  low_confidence?: boolean;
  meta?: {
    review_status?: string;
    version?: number;
    approved_by?: string;
    pending_evolve?: boolean;
    created_at?: string;
    created_by?: string;
    created_from?: string;
  };
}

interface EscalationActor {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
}

interface EscalationItem {
  id: string;
  type: "chat_escalation";
  status: string;
  created_at: string;
  created_by: EscalationActor;
  created_from: {
    source: string;
    session_id: string;
    message_id: string;
  };
  lawyer: {
    user_id: string;
    display_name: string;
    email: string;
  };
  question: string;
  answer: string;
  clause_ref: string;
  position_used: string;
  escalation_reason: string;
  next_action: string;
  notification?: {
    status: string;
    sent_at: string;
    message: string;
  };
}

interface EvolveSuggestion {
  id: string;
  clause_id: string;
  proposed_change?: Record<string, unknown>;
}

type ReviewItem =
  | {
      type: "clause";
      id: string;
      title: string;
      status: string;
      createdAt: string;
      createdBy: string;
      createdFrom: string;
      playbookName: string;
      counterparty: string;
      sourceLabel: string;
      reason: string;
      clause: ReviewClause;
    }
  | {
      type: "escalation";
      id: string;
      title: string;
      status: string;
      createdAt: string;
      createdBy: string;
      createdFrom: string;
      playbookName: string;
      counterparty: string;
      sourceLabel: string;
      reason: string;
      escalation: EscalationItem;
    };

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function formatDate(value: string) {
  if (!value) return "Not Available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function clauseDraft(clause: ReviewClause) {
  return {
    name: clause.name ?? "",
    positions: {
      preferred: clause.positions?.preferred ?? "",
      fallback_1: clause.positions?.fallback_1 ?? "",
      fallback_2: clause.positions?.fallback_2 ?? "",
    },
    red_line: clause.red_line ?? "",
    escalation_trigger: clause.escalation_trigger ?? "",
    always_escalate: Boolean(clause.always_escalate),
    keywords: clause.keywords ?? [],
  };
}

function formatLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function actorName(actor: EscalationActor) {
  return actor.display_name || actor.email || "Business User";
}

function tabularReviewTitle(item: EscalationItem) {
  const deviationCount = item.answer.match(/found (\d+) deviation/i)?.[1];
  const files = item.answer.match(/Files:\s*(.+)$/i)?.[1]?.trim();

  if (item.created_from.source === "tabular_review") {
    if (deviationCount && files) return `${deviationCount} deviations in ${files}`;
    if (deviationCount) return `${deviationCount} tabular review deviations`;
    return "Tabular review needs legal review";
  }

  return item.clause_ref || "Chat escalation";
}

function clauseRefParts(clauseRef: string) {
  return clauseRef
    .split(/,\s+(?=[^,\s]+:)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function shortClauseLabel(value: string) {
  const withoutPlaybookPrefix = value.includes(":")
    ? value.slice(value.indexOf(":") + 1)
    : value;
  const match = withoutPlaybookPrefix.match(/^([A-Z]+-\d+)\s+(.+)$/);
  if (!match) return withoutPlaybookPrefix;

  const [, clauseId, title] = match;
  return `${clauseId}: ${title.split(":")[0]}`;
}

function escalationClauseLabels(clauseRef: string) {
  const labels = clauseRefParts(clauseRef).map(shortClauseLabel);
  return labels.length > 0 ? labels : ["Referenced clause"];
}

function sourceFilesLabel(files?: string[]) {
  if (!files || files.length === 0) return "";
  if (files.length === 1) return files[0];
  return `${files[0]} + ${files.length - 1} more`;
}

function clauseSourceLabel(clause: ReviewClause) {
  const parts = [
    clause.playbook_name,
    sourceFilesLabel(clause.source_files),
    clause.original_clause_id,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : clause.meta?.created_from ?? "playbook_ingest";
}

function clauseAttentionReason(clause: ReviewClause, hasPendingSuggestion: boolean) {
  const reviewStatus = clause.meta?.review_status ?? "pending";
  if (hasPendingSuggestion) return "Evolve suggestion";
  if (reviewStatus !== "approved") {
    if (clause.low_confidence) return "Low confidence extraction";
    return "Pending clause review";
  }
  return "Open review item";
}

function clauseNeedsAttention(clause: ReviewClause, hasPendingSuggestion: boolean) {
  const reviewStatus = clause.meta?.review_status ?? "pending";
  if (reviewStatus === "declined") return false;

  if (hasPendingSuggestion) return true;
  return reviewStatus !== "approved";
}

function uniqueCount(values: string[]) {
  return new Set(values.filter((value) => value.trim().length > 0)).size;
}

export default function ReviewPage() {
  const [clauses, setClauses] = useState<ReviewClause[]>([]);
  const [escalations, setEscalations] = useState<EscalationItem[]>([]);
  const [evolveSuggestions, setEvolveSuggestions] = useState<EvolveSuggestion[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [detailOpen, setDetailOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [clauseList, escalationList, evolveList] = await Promise.all([
        apiJson<ReviewClause[]>("/playbook/review"),
        apiJson<EscalationItem[]>("/escalations"),
        apiJson<EvolveSuggestion[]>("/evolve"),
      ]);
      setClauses(clauseList);
      setEscalations(escalationList);
      setEvolveSuggestions(evolveList);
      setDrafts(
        Object.fromEntries(
          clauseList.map((clause) => [
            clause.clause_id,
            JSON.stringify(clauseDraft(clause)),
          ])
        )
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  const items = useMemo<ReviewItem[]>(() => {
    const pendingSuggestionClauseIds = new Set(
      evolveSuggestions.map((suggestion) => suggestion.clause_id)
    );

    const escalationItems: ReviewItem[] = escalations
      .filter((item) => item.status === "pending_review")
      .map((item) => ({
        type: "escalation",
        id: item.id,
        title: tabularReviewTitle(item),
        status: item.status,
        createdAt: item.created_at,
        createdBy: actorName(item.created_by),
        createdFrom: item.created_from.source || "chat",
        playbookName: escalationClauseLabels(item.clause_ref).join(", "),
        counterparty: actorName(item.created_by),
        sourceLabel: `${item.created_from.source || "chat"} · ${item.created_from.message_id}`,
        reason: "Chat escalation",
        escalation: item,
      }));

    const clauseItems: ReviewItem[] = clauses
      .filter((clause) =>
        clauseNeedsAttention(clause, pendingSuggestionClauseIds.has(clause.clause_id))
      )
      .map((clause) => {
        const hasPendingSuggestion = pendingSuggestionClauseIds.has(clause.clause_id);
        return {
          type: "clause",
          id: clause.clause_id,
          title: clause.name,
          status: clause.meta?.review_status ?? "pending",
          createdAt: clause.meta?.created_at ?? "",
          createdBy: clause.meta?.created_by ?? clause.meta?.approved_by ?? "Legal Counsel",
          createdFrom: clause.meta?.created_from ?? "playbook_ingest",
          playbookName: clause.playbook_name ?? "Default Playbook",
          counterparty: clause.party_name ?? "Unknown counterparty",
          sourceLabel: clauseSourceLabel(clause),
          reason: clauseAttentionReason(clause, hasPendingSuggestion),
          clause,
        };
      });

    return [...escalationItems, ...clauseItems];
  }, [clauses, escalations, evolveSuggestions]);

  const dashboardStats = useMemo(
    () => ({
      total: items.length,
      clausesPending: items.filter((item) => item.type === "clause").length,
      escalations: items.filter((item) => item.type === "escalation").length,
      playbooks: uniqueCount(items.map((item) => item.playbookName)),
      counterparties: uniqueCount(items.map((item) => item.counterparty)),
    }),
    [items]
  );

  const boundedActiveIndex = Math.min(activeIndex, Math.max(items.length - 1, 0));
  const activeItem = items[boundedActiveIndex];

  const goNext = useCallback(() => {
    setDirection("next");
    setDetailOpen(true);
    setActiveIndex((index) => Math.min(index + 1, Math.max(items.length - 1, 0)));
  }, [items.length]);

  const goPrev = useCallback(() => {
    setDirection("prev");
    setDetailOpen(true);
    setActiveIndex((index) => Math.max(index - 1, 0));
  }, []);

  const selectItem = useCallback(
    (index: number) => {
      setDirection(index >= boundedActiveIndex ? "next" : "prev");
      setActiveIndex(index);
      setDetailOpen(true);
    },
    [boundedActiveIndex]
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if (event.key === "ArrowRight") goNext();
      if (event.key === "ArrowLeft") goPrev();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrev]);

  async function persistDraft(clauseId: string) {
    await apiJson(`/playbook/${encodeURIComponent(clauseId)}`, {
      method: "PATCH",
      body: drafts[clauseId],
    });
  }

  function draftFor(clause: ReviewClause) {
    return JSON.parse(drafts[clause.clause_id] ?? "{}") as ReturnType<typeof clauseDraft>;
  }

  function updateDraft(
    clauseId: string,
    updater: (draft: ReturnType<typeof clauseDraft>) => ReturnType<typeof clauseDraft>
  ) {
    setDrafts((prev) => {
      const next = updater(JSON.parse(prev[clauseId] ?? "{}"));
      return { ...prev, [clauseId]: JSON.stringify(next) };
    });
  }

  async function approve(clause: ReviewClause) {
    try {
      const suggestion = evolveSuggestions.find((item) => item.clause_id === clause.clause_id);
      if (suggestion) {
        const proposedChange = JSON.parse(drafts[clause.clause_id] ?? "{}");
        await apiJson(`/evolve/${encodeURIComponent(suggestion.id)}/approve`, {
          method: "POST",
          body: JSON.stringify({ proposed_change: proposedChange }),
        });
      } else {
        await persistDraft(clause.clause_id);
        await apiJson(`/playbook/${encodeURIComponent(clause.clause_id)}/approve`, {
          method: "POST",
          body: JSON.stringify({ approved_by: "lawyer" }),
        });
      }
      await refresh();
      setDetailOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function decline(clauseId: string) {
    try {
      await apiJson(`/playbook/${encodeURIComponent(clauseId)}/decline`, {
        method: "POST",
        body: JSON.stringify({ declined_by: "lawyer" }),
      });
      await refresh();
      setDetailOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function resolveEscalation(id: string) {
    try {
      const reviewer = localReviewer();
      await apiJson(`/escalations/${encodeURIComponent(id)}/resolve`, {
        method: "POST",
        body: JSON.stringify({
          reviewed_by: reviewer,
        }),
      });
      await refresh();
      setDetailOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function declineEscalation(id: string) {
    try {
      const reviewer = localReviewer();
      await apiJson(`/escalations/${encodeURIComponent(id)}/decline`, {
        method: "POST",
        body: JSON.stringify({
          reviewed_by: reviewer,
        }),
      });
      await refresh();
      setDetailOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="flex h-full flex-col overflow-hidden bg-background p-6 text-foreground">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-livebook-dark">
              Human-in-the-loop
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Review Queue</h1>
            <p className="text-sm text-muted-foreground">
              {items.length === 0
                ? "No open review items"
                : `${dashboardStats.total} items need attention`}
            </p>
          </div>
          {detailOpen && activeItem && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDetailOpen(false)}
              >
                <i className="ri-arrow-left-line text-base" data-icon="inline-start" />
                Back to queue
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={goPrev}
                disabled={boundedActiveIndex === 0 || items.length === 0}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={goNext}
                disabled={boundedActiveIndex >= items.length - 1}
              >
                Next
                <i className="ri-arrow-right-line text-base" data-icon="inline-end" />
              </Button>
            </div>
          )}
        </header>

        {error && <Notice tone="danger" className="mb-4">{error}</Notice>}

        {isLoading && items.length === 0 ? (
          <Notice tone="neutral">Loading review queue...</Notice>
        ) : items.length === 0 ? (
          <PremiumEmpty
            icon={<i className="ri-clipboard-line text-base" />}
            title="No review items"
            description="No clauses or escalations are available for review."
          />
        ) : !detailOpen || !activeItem ? (
          <AttentionDashboard
            items={items}
            activeIndex={boundedActiveIndex}
            stats={dashboardStats}
            onSelect={selectItem}
          />
        ) : (
          <section
            key={activeItem.id}
            className={`review-slide-${direction} flex min-h-0 flex-1 flex-col rounded-lg border bg-card p-5 shadow-sm`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
              <div>
                <p className="font-mono text-xs text-muted-foreground">{activeItem.id}</p>
                <h2 className="text-xl font-semibold">{activeItem.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{activeItem.reason}</p>
              </div>
              <dl className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                <div>
                  <dt className="font-semibold text-foreground">Created</dt>
                  <dd>{formatDate(activeItem.createdAt)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-foreground">By</dt>
                  <dd>{activeItem.createdBy}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-foreground">Source</dt>
                  <dd>{activeItem.sourceLabel || activeItem.createdFrom}</dd>
                </div>
              </dl>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pt-4">
              {activeItem.type === "escalation" ? (
                <EscalationReview
                  escalation={activeItem.escalation}
                  onApprove={() => resolveEscalation(activeItem.escalation.id)}
                  onDecline={() => declineEscalation(activeItem.escalation.id)}
                />
              ) : (
                <ClauseReview
                  clause={activeItem.clause}
                  draft={draftFor(activeItem.clause)}
                  updateDraft={updateDraft}
                  onApprove={() => approve(activeItem.clause)}
                  onDecline={() => decline(activeItem.clause.clause_id)}
                />
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function AttentionDashboard({
  items,
  activeIndex,
  stats,
  onSelect,
}: {
  items: ReviewItem[];
  activeIndex: number;
  stats: {
    total: number;
    clausesPending: number;
    escalations: number;
    playbooks: number;
    counterparties: number;
  };
  onSelect: (index: number) => void;
}) {
  const cards = [
    { label: "Attention items", value: stats.total },
    { label: "Clauses", value: stats.clausesPending },
    { label: "Escalations", value: stats.escalations },
    { label: "Playbooks", value: stats.playbooks },
    { label: "Counterparties", value: stats.counterparties },
  ];

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card p-4 shadow-sm">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((card) => (
          <MetricTile key={card.label} label={card.label} value={card.value} />
        ))}
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-lg border">
        <table className="w-full min-w-[920px] border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-muted text-xs font-semibold text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Playbook</th>
              <th className="px-3 py-2">Counterparty</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">By</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr
                key={item.id}
                onClick={() => onSelect(index)}
                className={cn(
                  "cursor-pointer border-t transition-colors hover:bg-muted/60",
                  index === activeIndex && "bg-accent/70 text-accent-foreground"
                )}
              >
                <td className="max-w-[220px] truncate px-3 py-2 font-semibold">{item.title}</td>
                <td className="max-w-[180px] truncate px-3 py-2">{item.playbookName}</td>
                <td className="max-w-[160px] truncate px-3 py-2">{item.counterparty}</td>
                <td className="max-w-[220px] truncate px-3 py-2">{item.sourceLabel}</td>
                <td className="max-w-[140px] truncate px-3 py-2">{item.createdBy}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDate(item.createdAt)}</td>
                <td className="max-w-[160px] px-3 py-2">
                  <StatusBadge tone={statusTone(item.reason)}>{item.reason}</StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EscalationReview({
  escalation,
  onApprove,
  onDecline,
}: {
  escalation: EscalationItem;
  onApprove: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
      <div className="flex flex-col gap-4">
        <section className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h3 className="font-semibold text-red-900">Escalation Request</h3>
          <p className="mt-2 text-sm text-red-900">{escalation.escalation_reason || "No reason entered"}</p>
          <p className="mt-3 rounded-lg bg-card p-3 text-sm text-foreground">
            {escalation.question}
          </p>
        </section>
        <section className="rounded-lg border bg-card p-4">
          <h3 className="font-semibold">Answer Context</h3>
          <LegalTextPanel className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm">
            {escalation.answer}
          </LegalTextPanel>
          <Notice tone="accent" className="mt-3">{escalation.next_action}</Notice>
        </section>
      </div>
      <aside className="flex flex-col gap-4">
        <section className="rounded-lg border bg-card p-4 text-sm">
          <h3 className="font-semibold">Routing</h3>
          <dl className="mt-3 flex flex-col gap-2 text-muted-foreground">
            <div>
              <dt className="text-xs font-semibold text-foreground">Lawyer</dt>
              <dd>{escalation.lawyer.display_name || escalation.lawyer.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-foreground">Notification</dt>
              <dd>{escalation.notification?.status ?? "queued"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-foreground">Clauses</dt>
              <dd>
                <ul className="flex flex-col gap-1">
                  {escalationClauseLabels(escalation.clause_ref).map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-foreground">Position</dt>
              <dd>{escalation.position_used}</dd>
            </div>
          </dl>
        </section>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onDecline}
          >
            <i className="ri-close-line text-base" data-icon="inline-start" />
            Decline
          </Button>
          <Button
            type="button"
            onClick={onApprove}
          >
            <i className="ri-check-line text-base" data-icon="inline-start" />
            Approve
          </Button>
        </div>
      </aside>
    </div>
  );
}

function ClauseReview({
  clause,
  draft,
  updateDraft,
  onApprove,
  onDecline,
}: {
  clause: ReviewClause;
  draft: ReturnType<typeof clauseDraft>;
  updateDraft: (
    clauseId: string,
    updater: (draft: ReturnType<typeof clauseDraft>) => ReturnType<typeof clauseDraft>
  ) => void;
  onApprove: () => void;
  onDecline: () => void;
}) {
  return (
    <>
      <div className="mb-4 text-xs font-semibold text-muted-foreground">
        Version {clause.meta?.version ?? 1}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="text-xs font-semibold text-muted-foreground">
          Name
          <Input
            value={draft.name ?? ""}
            onChange={(event) =>
              updateDraft(clause.clause_id, (current) => ({ ...current, name: event.target.value }))
            }
            className="mt-1 font-normal"
          />
        </label>
        <label className="text-xs font-semibold text-muted-foreground">
          Keywords
          <Input
            value={(draft.keywords ?? []).join(", ")}
            onChange={(event) =>
              updateDraft(clause.clause_id, (current) => ({
                ...current,
                keywords: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
              }))
            }
            className="mt-1 font-normal"
          />
        </label>
        {(["preferred", "fallback_1", "fallback_2"] as const).map((field) => (
          <label key={field} className="text-xs font-semibold text-muted-foreground">
            {formatLabel(field)}
            <Textarea
              value={draft.positions?.[field] ?? ""}
              onChange={(event) =>
                updateDraft(clause.clause_id, (current) => ({
                  ...current,
                  positions: {
                    preferred: current.positions?.preferred ?? "",
                    fallback_1: current.positions?.fallback_1 ?? "",
                    fallback_2: current.positions?.fallback_2 ?? "",
                    [field]: event.target.value,
                  },
                }))
              }
              className="mt-1 h-24 font-normal"
            />
          </label>
        ))}
        <label className="text-xs font-semibold text-muted-foreground">
          Red line
          <Textarea
            value={draft.red_line ?? ""}
            onChange={(event) =>
              updateDraft(clause.clause_id, (current) => ({ ...current, red_line: event.target.value }))
            }
            className="mt-1 h-24 font-normal"
          />
        </label>
        <label className="text-xs font-semibold text-muted-foreground">
          Escalation trigger
          <Textarea
            value={draft.escalation_trigger ?? ""}
            onChange={(event) =>
              updateDraft(clause.clause_id, (current) => ({
                ...current,
                escalation_trigger: event.target.value,
              }))
            }
            className="mt-1 h-24 font-normal"
          />
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Checkbox
            checked={Boolean(draft.always_escalate)}
            onCheckedChange={(checked) =>
              updateDraft(clause.clause_id, (current) => ({
                ...current,
                always_escalate: Boolean(checked),
              }))
            }
          />
          Always escalate
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onDecline}
        >
          <i className="ri-close-line text-base" data-icon="inline-start" />
          Decline
        </Button>
        <Button
          type="button"
          onClick={onApprove}
        >
          <i className="ri-check-line text-base" data-icon="inline-start" />
          Approve
        </Button>
      </div>
    </>
  );
}
