"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LegalTextPanel, Notice, PageHeader, PremiumEmpty, StatusBadge, statusTone } from "@/components/premium";
import { cn } from "@/lib/utils";

const API_BASE = "/api/backend";
const FORWARDING_ADDRESS = "learn@livebook.ai";

type ClauseStatus = "ok" | "review pending" | "evolve suggestion" | "escalated";

interface Clause {
  clause_id: string;
  name: string;
  positions?: Record<string, string>;
  red_line?: string;
  escalation_trigger?: string;
  always_escalate?: boolean;
  keywords?: string[];
  negotiation_history?: NegotiationHistory[];
  history?: ClauseHistory[];
  low_confidence?: boolean;
  status?: ClauseStatus;
  raw_source_segment?: string;
  meta?: {
    version?: number;
    approved_by?: string;
    review_status?: "pending" | "approved";
    pending_evolve?: boolean;
  };
}

interface NegotiationHistory {
  contract_id?: string;
  counterparty?: string;
  outcome?: string;
  jurisdiction?: string;
  amount?: string;
  escalated?: boolean;
  date?: string;
}

interface ClauseHistory {
  version: number;
  approved_by: string;
  timestamp: string;
  action: "edit" | "restore";
  fields_snapshot: Partial<Clause>;
}

interface EvolveSuggestion {
  id: string;
  clause_id: string;
  pattern_description: string;
  supporting_contracts: string[];
  proposed_change: Partial<Clause>;
  confidence: "low" | "medium" | "high";
}

interface EmailQueueEntry {
  id: string;
  subject: string;
  body?: string;
  low_confidence?: boolean;
  status: "pending_review" | "approved" | "rejected";
  created_at: string;
  extracted?: {
    counterparty?: string;
    clauses?: EmailExtractedClause[];
  };
}

interface EmailExtractedClause {
  clause_id: string;
  outcome: "preferred" | "fallback_1" | "fallback_2" | "red_line_breached";
  confidence?: "low" | "medium" | "high";
  evidence?: string;
  rationale?: string;
  jurisdiction?: string;
  amount?: string;
  escalated?: boolean;
}

function textFromChange(change: Partial<Clause>) {
  if (change.positions?.preferred) return change.positions.preferred;
  if (change.red_line) return change.red_line;
  return JSON.stringify(change, null, 2);
}

function formatLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export default function LawyerDashboard() {
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedClause, setSelectedClause] = useState<Clause | null>(null);
  const [evolve, setEvolve] = useState<EvolveSuggestion[]>([]);
  const [editDraft, setEditDraft] = useState<Partial<Clause>>({});
  const [evolveDraft, setEvolveDraft] = useState("");
  const [emailQueue, setEmailQueue] = useState<EmailQueueEntry[]>([]);
  const [emailBusyId, setEmailBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [jurisdictionFilter, setJurisdictionFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [clauseList, suggestions, emailEntries] = await Promise.all([
        apiJson<Clause[]>("/playbook"),
        apiJson<EvolveSuggestion[]>("/evolve"),
        apiJson<EmailQueueEntry[]>("/email/queue"),
      ]);
      setClauses(clauseList);
      setEvolve(suggestions);
      setEmailQueue(emailEntries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadClause = useCallback(async (clauseId: string) => {
    const clause = await apiJson<Clause>(`/playbook/${encodeURIComponent(clauseId)}`);
    const history = await apiJson<ClauseHistory[]>(`/playbook/${encodeURIComponent(clauseId)}/history`);
    setSelectedId(clauseId);
    setSelectedClause({ ...clause, history });
    setEditDraft({
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
    });
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void refresh();
    }, 0);
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    if (selectedId) {
      const timeout = window.setTimeout(() => {
        loadClause(selectedId).catch((err) =>
          setError(err instanceof Error ? err.message : String(err))
        );
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, [clauses, loadClause, selectedId]);

  const selectedSuggestion = useMemo(
    () => evolve.find((item) => item.clause_id === selectedClause?.clause_id),
    [evolve, selectedClause?.clause_id]
  );

  useEffect(() => {
    if (selectedSuggestion) {
      const timeout = window.setTimeout(() => {
        setEvolveDraft(textFromChange(selectedSuggestion.proposed_change));
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, [selectedSuggestion]);

  const filteredNegotiations = useMemo(() => {
    const rows = selectedClause?.negotiation_history ?? [];
    return rows.filter((row) => {
      const jurisdictionOk =
        jurisdictionFilter === "all" || row.jurisdiction === jurisdictionFilter;
      const outcomeOk = outcomeFilter === "all" || row.outcome === outcomeFilter;
      return jurisdictionOk && outcomeOk;
    });
  }, [jurisdictionFilter, outcomeFilter, selectedClause?.negotiation_history]);

  const jurisdictions = useMemo(() => {
    const values = new Set(
      (selectedClause?.negotiation_history ?? [])
        .map((row) => row.jurisdiction)
        .filter((value): value is string => Boolean(value))
    );
    return Array.from(values);
  }, [selectedClause?.negotiation_history]);

  async function saveDraft() {
    if (!selectedClause) return;
    await apiJson<Clause>(`/playbook/${encodeURIComponent(selectedClause.clause_id)}`, {
      method: "PATCH",
      body: JSON.stringify(editDraft),
    });
    await refresh();
  }

  async function approveClause() {
    if (!selectedClause) return;
    await apiJson<Clause>(`/playbook/${encodeURIComponent(selectedClause.clause_id)}/approve`, {
      method: "POST",
      body: JSON.stringify({ approved_by: "lawyer" }),
    });
    await refresh();
  }

  async function restoreVersion(version: number) {
    if (!selectedClause) return;
    await apiJson<Clause>(
      `/playbook/${encodeURIComponent(selectedClause.clause_id)}/restore/${version}`,
      { method: "POST" }
    );
    await refresh();
  }

  async function approveEvolve(suggestion: EvolveSuggestion) {
    try {
      const proposed_change = suggestion.proposed_change.positions?.preferred
        ? { positions: { preferred: evolveDraft } }
        : suggestion.proposed_change.red_line
          ? { red_line: evolveDraft }
          : suggestion.proposed_change;
      await apiJson<Clause>(`/evolve/${suggestion.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ proposed_change }),
      });
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("modified")
          ? "Clause was modified - please review again"
          : String(err)
      );
    }
  }

  async function rejectEvolve(suggestionId: string) {
    await apiJson<EvolveSuggestion>(`/evolve/${suggestionId}/reject`, {
      method: "POST",
    });
    await refresh();
  }

  async function approveEmailInsight(entryId: string) {
    setEmailBusyId(entryId);
    setNotice(null);
    try {
      await apiJson<EmailQueueEntry>(`/email/queue/${encodeURIComponent(entryId)}/approve`, {
        method: "POST",
      });
      setNotice("Email insights added to negotiation history. Evolve refreshed.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEmailBusyId(null);
    }
  }

  async function rejectEmailInsight(entryId: string) {
    setEmailBusyId(entryId);
    setNotice(null);
    try {
      await apiJson<EmailQueueEntry>(`/email/queue/${encodeURIComponent(entryId)}/reject`, {
        method: "POST",
      });
      setNotice("Email insights rejected.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEmailBusyId(null);
    }
  }

  function updateDraftField(field: keyof Clause, value: string | boolean | string[]) {
    setEditDraft((prev) => ({ ...prev, [field]: value }));
  }

  function updatePositionField(field: "preferred" | "fallback_1" | "fallback_2", value: string) {
    setEditDraft((prev) => ({
      ...prev,
      positions: {
        preferred: prev.positions?.preferred ?? "",
        fallback_1: prev.positions?.fallback_1 ?? "",
        fallback_2: prev.positions?.fallback_2 ?? "",
        [field]: value,
      },
    }));
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <section className="legal-hairline flex w-[430px] flex-col border-r bg-card/92">
        <header className="border-b px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-livebook-dark">
                Legal control
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">Lawyer Dashboard</h2>
              <p className="text-sm text-muted-foreground">Clauses, review, evolve, history</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={refresh}
              title="Refresh"
              aria-label="Refresh"
            >
              <i className="ri-refresh-line text-base" />
            </Button>
          </div>
          {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
          {notice && <Notice tone="success" className="mt-3">{notice}</Notice>}
        </header>

        <section className="border-b bg-muted/35 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <i className="ri-inbox-line text-base text-livebook" />
                Email Insights
              </h3>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{FORWARDING_ADDRESS}</p>
            </div>
            <StatusBadge tone={emailQueue.length > 0 ? "warning" : "neutral"}>{emailQueue.length}</StatusBadge>
          </div>
          <div className="mt-3 flex max-h-80 flex-col gap-3 overflow-y-auto pr-1">
            {emailQueue.length === 0 ? (
              <p className="text-xs text-muted-foreground">No pending email insights.</p>
            ) : (
              emailQueue.map((entry) => (
                <EmailInsightCard
                  key={entry.id}
                  entry={entry}
                  busy={emailBusyId === entry.id}
                  onApprove={() => approveEmailInsight(entry.id)}
                  onReject={() => rejectEmailInsight(entry.id)}
                />
              ))
            )}
          </div>
        </section>

        <div className="flex-1 overflow-y-auto">
          {clauses.map((clause) => {
            const status = clause.status ?? "ok";
            const lastHistory = clause.negotiation_history?.at(-1);
            return (
              <button
                key={clause.clause_id}
                onClick={() => loadClause(clause.clause_id)}
                className={cn(
                  "w-full border-b px-5 py-4 text-left transition-colors hover:bg-muted/60",
                  selectedId === clause.clause_id && "bg-accent/70"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{clause.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {clause.positions?.preferred ?? "No preferred position"}
                    </p>
                  </div>
                  <StatusBadge tone={statusTone(status)} className="shrink-0">
                    {formatLabel(status)}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Last counterparty: {lastHistory?.counterparty ?? "None"}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="min-w-0 flex-1 overflow-y-auto">
        {!selectedClause ? (
          <div className="flex h-full items-center justify-center p-8">
            <PremiumEmpty
              icon={<i className="ri-shield-alert-line text-base" />}
              title="Select a clause"
              description="Review source text, structured positions, negotiation history, and version records."
              className="max-w-xl"
            />
          </div>
        ) : (
          <div>
            <PageHeader
              eyebrow={selectedClause.clause_id}
              title={selectedClause.name}
              description={`Version ${selectedClause.meta?.version ?? 1} · ${formatLabel(selectedClause.meta?.review_status ?? "pending")}`}
              actions={
                <Button type="button" onClick={approveClause}>
                  <i className="ri-check-line text-base" data-icon="inline-start" />
                  Approve
                </Button>
              }
            />

            <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
              <div className="space-y-5">
                <section className="rounded-lg border bg-card p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Structured Data</h3>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={saveDraft}
                      >
                        <i className="ri-save-line text-base" data-icon="inline-start" />
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditDraft({
                            name: selectedClause.name ?? "",
                            positions: {
                              preferred: selectedClause.positions?.preferred ?? "",
                              fallback_1: selectedClause.positions?.fallback_1 ?? "",
                              fallback_2: selectedClause.positions?.fallback_2 ?? "",
                            },
                            red_line: selectedClause.red_line ?? "",
                            escalation_trigger: selectedClause.escalation_trigger ?? "",
                            always_escalate: Boolean(selectedClause.always_escalate),
                            keywords: selectedClause.keywords ?? [],
                          })
                        }
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Name
                      <Input
                        value={editDraft.name ?? ""}
                        onChange={(event) => updateDraftField("name", event.target.value)}
                        className="mt-1 font-normal"
                      />
                    </label>
                    <label className="text-xs font-semibold text-muted-foreground">
                      Keywords
                      <Input
                        value={(editDraft.keywords ?? []).join(", ")}
                        onChange={(event) =>
                          updateDraftField(
                            "keywords",
                            event.target.value.split(",").map((item) => item.trim()).filter(Boolean)
                          )
                        }
                        className="mt-1 font-normal"
                      />
                    </label>
                    {(["preferred", "fallback_1", "fallback_2"] as const).map((field) => (
                      <label key={field} className="text-xs font-semibold text-muted-foreground">
                        {formatLabel(field)}
                        <Textarea
                          value={editDraft.positions?.[field] ?? ""}
                          onChange={(event) => updatePositionField(field, event.target.value)}
                          className="mt-1 h-24 font-normal"
                        />
                      </label>
                    ))}
                    <label className="text-xs font-semibold text-muted-foreground">
                      Red line
                      <Textarea
                        value={editDraft.red_line ?? ""}
                        onChange={(event) => updateDraftField("red_line", event.target.value)}
                        className="mt-1 h-24 font-normal"
                      />
                    </label>
                    <label className="text-xs font-semibold text-muted-foreground">
                      Escalation trigger
                      <Textarea
                        value={editDraft.escalation_trigger ?? ""}
                        onChange={(event) => updateDraftField("escalation_trigger", event.target.value)}
                        className="mt-1 h-24 font-normal"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Checkbox
                        checked={Boolean(editDraft.always_escalate)}
                        onCheckedChange={(checked) => updateDraftField("always_escalate", Boolean(checked))}
                      />
                      Always escalate
                    </label>
                  </div>
                </section>

                {selectedSuggestion && (
                  <section className="rounded-lg border border-sky-200 bg-sky-50 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="flex items-center gap-2 font-semibold text-sky-950">
                          <i className="ri-sparkling-line text-base" />
                          Evolve Suggestion
                        </h3>
                        <p className="mt-1 text-sm text-sky-900">
                          {selectedSuggestion.pattern_description}
                        </p>
                        <Textarea
                          value={evolveDraft}
                          onChange={(event) => setEvolveDraft(event.target.value)}
                          className="mt-3 h-24 border-sky-200 bg-card/90"
                        />
                        <p className="mt-2 text-xs text-sky-800">
                          Evidence: {selectedSuggestion.supporting_contracts.join(", ") || "none"} ·{" "}
                          {selectedSuggestion.confidence}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => approveEvolve(selectedSuggestion)}
                        >
                          Approve
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => rejectEvolve(selectedSuggestion.id)}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  </section>
                )}

                <section className="rounded-lg border bg-card p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold">Negotiation History</h3>
                    <div className="flex gap-2">
                      <Select
                        value={jurisdictionFilter}
                        onValueChange={setJurisdictionFilter}
                      >
                        <SelectTrigger className="h-8 w-[180px] text-xs">
                          <SelectValue placeholder="Jurisdiction" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="all">All jurisdictions</SelectItem>
                            {jurisdictions.map((value) => (
                              <SelectItem key={value} value={value}>
                                {value}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <Select
                        value={outcomeFilter}
                        onValueChange={setOutcomeFilter}
                      >
                        <SelectTrigger className="h-8 w-[180px] text-xs">
                          <SelectValue placeholder="Outcome" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="all">All outcomes</SelectItem>
                            <SelectItem value="preferred">Preferred</SelectItem>
                            <SelectItem value="fallback_1">Fallback 1</SelectItem>
                            <SelectItem value="fallback_2">Fallback 2</SelectItem>
                            <SelectItem value="red_line_breached">Red Line Breached</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {filteredNegotiations.length === 0 ? (
                    <PremiumEmpty
                      icon={<i className="ri-time-line text-base" />}
                      title="No negotiation history yet"
                      description="Approved email or tabular insights will appear here."
                      className="mt-4 min-h-44"
                    />
                  ) : (
                    <div className="mt-4 divide-y">
                      {filteredNegotiations.map((row, index) => (
                        <div key={`${row.contract_id}-${index}`} className="py-3 text-sm">
                          <p className="font-semibold">{row.contract_id ?? "Contract"}</p>
                          <p className="text-muted-foreground">
                            {row.counterparty ?? "Unknown"} ·{" "}
                            {row.jurisdiction ?? "Not Available"} ·{" "}
                            {formatLabel(row.outcome ?? "not available")} ·{" "}
                            {row.escalated ? "Escalated" : "Not Escalated"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <aside className="space-y-5">
                <section className="rounded-lg border bg-card p-5 shadow-sm">
                  <h3 className="font-semibold">Raw Source</h3>
                  <LegalTextPanel className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap">
                    {selectedClause.raw_source_segment || "No source text available"}
                  </LegalTextPanel>
                </section>

                <section className="rounded-lg border bg-card p-5 shadow-sm">
                  <h3 className="font-semibold">Version History</h3>
                  {(selectedClause.history ?? []).length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">No versions yet</p>
                  ) : (
                    <div className="mt-3 flex flex-col gap-3">
                      {(selectedClause.history ?? []).map((entry) => (
                        <div key={`${entry.version}-${entry.timestamp}`} className="rounded-lg border bg-muted/35 p-3">
                          <p className="text-sm font-semibold">
                            v{entry.version} · {entry.action}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {entry.approved_by} · {new Date(entry.timestamp).toLocaleString()}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => restoreVersion(entry.version)}
                            className="mt-2"
                          >
                            Restore
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </aside>
            </div>
          </div>
          </div>
        )}
      </section>
    </div>
  );
}

function EmailInsightCard({
  entry,
  busy,
  onApprove,
  onReject,
}: {
  entry: EmailQueueEntry;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const clauses = entry.extracted?.clauses ?? [];
  const counterparty = entry.extracted?.counterparty || "Unknown counterparty";

  return (
    <article className="rounded-lg border bg-card p-3 text-xs shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{counterparty}</p>
          <p className="mt-1 truncate text-muted-foreground">{entry.subject || entry.id}</p>
        </div>
        {entry.low_confidence ? (
          <StatusBadge tone="warning" className="shrink-0">Low</StatusBadge>
        ) : null}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {clauses.length === 0 ? (
          <p className="rounded-md bg-muted p-2 text-muted-foreground">No clause match found.</p>
        ) : (
          clauses.map((clause, index) => (
            <div key={`${entry.id}-${clause.clause_id}-${index}`} className="rounded-md border bg-muted/45 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold text-foreground">{clause.clause_id}</span>
                <StatusBadge tone={statusTone(clause.confidence ?? "low")}>
                  {formatLabel(clause.confidence ?? "low")}
                </StatusBadge>
                <StatusBadge tone={statusTone(clause.outcome)}>
                  {formatLabel(clause.outcome)}
                </StatusBadge>
                {clause.escalated ? (
                  <StatusBadge tone="danger">Escalated</StatusBadge>
                ) : null}
              </div>
              {clause.evidence ? (
                <p className="mt-2 line-clamp-3 text-muted-foreground">{clause.evidence}</p>
              ) : null}
              {clause.rationale ? (
                <p className="mt-1 line-clamp-2 text-muted-foreground">{clause.rationale}</p>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onApprove}
          disabled={busy || clauses.length === 0}
          className="flex-1"
        >
          <i className="ri-mail-check-line text-base" data-icon="inline-start" />
          {busy ? "Working" : "Approve"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReject}
          disabled={busy}
          className="flex-1"
        >
          Reject
        </Button>
      </div>
    </article>
  );
}
