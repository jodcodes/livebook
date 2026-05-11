"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { diffWords, type VersionDiffRow } from "@/lib/versionDiff";

const API_BASE = "/api/backend";

interface PlaybookSummary {
  id: string;
  name: string;
  law_type?: string;
  party_name?: string;
  clause_count: number;
}

interface Clause {
  clause_id: string;
  original_clause_id?: string;
  name?: string;
  clause_type?: string;
  positions?: {
    preferred?: string;
    fallback_1?: string;
    fallback_2?: string;
  };
  red_line?: string;
  escalation_trigger?: string;
  always_escalate?: boolean;
  keywords?: string[];
  meta?: {
    review_status?: string;
    version?: number;
  };
}

interface ClauseDiff {
  clause_id: string;
  name: string;
  status: "added" | "updated" | "removed";
  changed_fields: VersionDiffRow[];
}

interface PlaybookVersion {
  version_id: string;
  playbook_id: string;
  major: number;
  minor: number;
  label: string;
  action: string;
  timestamp?: string;
  changed_clause_ids?: string[];
  diff_summary?: {
    changed_clause_count?: number;
  };
  snapshot?: Clause[];
  diff?: ClauseDiff[];
}

interface PlaybookHistoryProps {
  canRestore?: boolean;
  audience?: "business" | "lawyer";
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

function formatTimestamp(timestamp?: string) {
  if (!timestamp) return "Unknown date";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatAction(action: string) {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatFieldValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "Not set";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function DiffRow({ row }: { row: VersionDiffRow }) {
  const diff = diffWords(row.from, row.to);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
        <h5 className="text-sm font-semibold text-foreground">{row.field}</h5>
        <span className="rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
          Changed
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2">
        <div className="border-b border-border p-4 md:border-b-0 md:border-r">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            Previous
          </p>
          <p className="text-sm leading-7 text-foreground/90">
            {diff.removed.map((part, index) => (
              <span
                key={`${part.token}-${index}`}
                className={
                  part.changed
                    ? "rounded bg-red-50 px-1 text-red-700 line-through"
                    : undefined
                }
              >
                {part.token}
              </span>
            ))}
          </p>
        </div>
        <div className="p-4">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
            Selected
          </p>
          <p className="text-sm leading-7 text-foreground/90">
            {diff.added.map((part, index) => (
              <span
                key={`${part.token}-${index}`}
                className={
                  part.changed
                    ? "rounded bg-emerald-50 px-1 text-emerald-700"
                    : undefined
                }
              >
                {part.token}
              </span>
            ))}
          </p>
        </div>
      </div>
    </section>
  );
}

function VersionCard({
  version,
  active,
  onOpen,
}: {
  version: PlaybookVersion;
  active: boolean;
  onOpen: (version: PlaybookVersion) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(version)}
      className={`w-full rounded-lg bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-livebook/30 ${
        active
          ? "border-2 border-livebook border-l-4 border-l-livebook ring-2 ring-livebook/20"
          : "border border-border border-l-4 border-l-slate-300"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <span className="rounded bg-livebook-pale px-2.5 py-1 font-mono text-xs font-bold text-livebook-dark">
          {version.label}
        </span>
        <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
          {version.diff_summary?.changed_clause_count ?? version.changed_clause_ids?.length ?? 0} changes
        </span>
      </div>
      <p className="text-sm font-semibold text-foreground">
        {formatAction(version.action)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{formatTimestamp(version.timestamp)}</p>
      <p className="mt-3 font-mono text-[11px] text-muted-foreground">{version.version_id}</p>
    </button>
  );
}

function ClauseSnapshotCard({ clause }: { clause: Clause }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">
            {clause.original_clause_id ?? clause.clause_id}
          </p>
          <h5 className="mt-1 text-sm font-semibold text-foreground">
            {clause.name ?? "Unnamed clause"}
          </h5>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
          {clause.meta?.review_status ?? "unknown"}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <p className="text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground/90">Preferred:</span>{" "}
          {formatFieldValue(clause.positions?.preferred)}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground/90">Fallback 1:</span>{" "}
          {formatFieldValue(clause.positions?.fallback_1)}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground/90">Fallback 2:</span>{" "}
          {formatFieldValue(clause.positions?.fallback_2)}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground/90">Always escalate:</span>{" "}
          {formatFieldValue(clause.always_escalate)}
        </p>
        <p className="text-xs leading-5 text-muted-foreground md:col-span-2">
          <span className="font-semibold text-foreground/90">Red line:</span>{" "}
          {formatFieldValue(clause.red_line)}
        </p>
        <p className="text-xs leading-5 text-muted-foreground md:col-span-2">
          <span className="font-semibold text-foreground/90">Escalation:</span>{" "}
          {formatFieldValue(clause.escalation_trigger)}
        </p>
      </div>
    </article>
  );
}

export default function PlaybookHistory({
  canRestore = true,
  audience = "business",
}: PlaybookHistoryProps) {
  void canRestore;
  void audience;
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([]);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState("");
  const [versions, setVersions] = useState<PlaybookVersion[]>([]);
  const [overview, setOverview] = useState<PlaybookVersion | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPlaybook = useMemo(
    () => playbooks.find((playbook) => playbook.id === selectedPlaybookId),
    [playbooks, selectedPlaybookId]
  );

  const loadPlaybooks = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await apiJson<PlaybookSummary[]>("/playbooks");
      setPlaybooks(list);
      setSelectedPlaybookId((current) => current || list[0]?.id || "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadVersions = useCallback(async (playbookId: string) => {
    if (!playbookId) {
      setVersions([]);
      return;
    }
    setIsLoading(true);
    try {
      const list = await apiJson<PlaybookVersion[]>(
        `/playbooks/${encodeURIComponent(playbookId)}/versions`
      );
      setVersions(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadPlaybooks();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadPlaybooks]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadVersions(selectedPlaybookId);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadVersions, selectedPlaybookId]);

  const openVersion = useCallback(async (version: PlaybookVersion) => {
    setIsLoadingDetail(true);
    try {
      const detail = await apiJson<PlaybookVersion>(
        `/playbooks/${encodeURIComponent(version.playbook_id)}/versions/${encodeURIComponent(
          version.version_id
        )}`
      );
      setOverview(detail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">Version History</h2>
          <p className="text-sm text-muted-foreground">
            Track playbook evolution by selected playbook
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedPlaybookId}
            onChange={(event) => {
              setSelectedPlaybookId(event.target.value);
              setOverview(null);
            }}
            className="min-w-72 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground/80 outline-none focus:border-livebook"
          >
            {playbooks.map((playbook) => (
              <option key={playbook.id} value={playbook.id}>
                {playbook.name} ({playbook.clause_count})
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 rounded-full border border-livebook/20 bg-livebook-pale px-3 py-1.5 text-sm font-medium text-livebook-dark">
            <i className="ri-git-branch-line"></i>
            {versions.length} Versions
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
        {error && (
          <div className="mb-4 flex shrink-0 items-center justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void loadVersions(selectedPlaybookId)}
              className="rounded-lg border border-red-200 bg-card px-3 py-1.5 text-xs font-semibold text-red-700"
            >
              Retry
            </button>
          </div>
        )}

        {selectedPlaybook && (
          <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{selectedPlaybook.name}</span>{" "}
            · {selectedPlaybook.law_type ?? "General Commercial"} ·{" "}
            {selectedPlaybook.party_name ?? "Opposite party"}
          </div>
        )}

        {isLoading && versions.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading version history...
          </div>
        ) : versions.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            No versions yet
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-muted/70">
            <div className="w-max min-w-full px-6 py-8">
              <div className="relative flex w-max min-w-full items-start gap-8">
                {versions.length > 1 && (
                  <div className="absolute left-44 right-44 top-5 h-0.5 bg-border" />
                )}
                {versions.map((version, index) => (
                  <div
                    key={version.version_id}
                    className="relative flex w-[22rem] shrink-0 flex-col items-center"
                  >
                    <div
                      className={`z-10 mb-6 flex h-10 w-10 items-center justify-center rounded-full border-4 bg-card ${
                        index === 0
                          ? "border-livebook text-livebook"
                          : "border-border text-muted-foreground/70"
                      }`}
                    >
                      <i className={index === 0 ? "ri-checkbox-circle-fill" : "ri-circle-line"} />
                    </div>
                    <VersionCard
                      version={version}
                      active={index === 0}
                      onOpen={(item) => void openVersion(item)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {overview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-6">
          <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-card shadow-xl">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-livebook-dark">
                  Playbook version
                </p>
                <h3 className="mt-1 text-lg font-semibold text-foreground">
                  {overview.label} · {selectedPlaybook?.name ?? overview.playbook_id}
                </h3>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {overview.version_id} · {formatAction(overview.action)} ·{" "}
                  {formatTimestamp(overview.timestamp)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOverview(null)}
                className="rounded-lg p-2 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground/80"
                aria-label="Close overview"
              >
                <i className="ri-close-line text-lg"></i>
              </button>
            </div>

            <div className="min-h-0 overflow-auto px-6 py-5">
              {isLoadingDetail ? (
                <div className="p-6 text-sm text-muted-foreground">Loading version...</div>
              ) : (
                <>
                  <section className="mb-6">
                    <div className="mb-3 flex items-center gap-2">
                      <i className="ri-git-compare-line text-livebook"></i>
                      <h4 className="text-sm font-semibold text-foreground">
                        Changed clauses
                      </h4>
                    </div>
                    {!overview.diff || overview.diff.length === 0 ? (
                      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                        No tracked clause changes for this version.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {overview.diff.map((clause) => (
                          <section
                            key={`${clause.clause_id}-${clause.status}`}
                            className="rounded-lg border border-border bg-muted/40 p-4"
                          >
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="font-mono text-xs text-muted-foreground">
                                  {clause.clause_id}
                                </p>
                                <h5 className="mt-1 text-sm font-semibold text-foreground">
                                  {clause.name}
                                </h5>
                              </div>
                              <span className="rounded bg-card px-2 py-1 text-xs font-semibold text-muted-foreground">
                                {clause.status}
                              </span>
                            </div>
                            {clause.changed_fields.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                Clause {clause.status}.
                              </p>
                            ) : (
                              <div className="space-y-3">
                                {clause.changed_fields.map((row) => (
                                  <DiffRow key={row.field} row={row} />
                                ))}
                              </div>
                            )}
                          </section>
                        ))}
                      </div>
                    )}
                  </section>

                  <section>
                    <div className="mb-3 flex items-center gap-2">
                      <i className="ri-book-open-line text-livebook"></i>
                      <h4 className="text-sm font-semibold text-foreground">
                        Full playbook snapshot
                      </h4>
                    </div>
                    <div className="space-y-3">
                      {(overview.snapshot ?? []).map((clause) => (
                        <ClauseSnapshotCard key={clause.clause_id} clause={clause} />
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
