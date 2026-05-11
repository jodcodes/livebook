"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../app/context/AuthContext";
import PlaybookUploadModal from "./PlaybookUploadModal";

const API_BASE = "/api/backend";
const SIEMENS_LAW_TYPES = [
  "Smart Infrastructure / Energy",
  "Digital Industries / Automation",
  "Data Privacy & Cybersecurity",
  "Procurement & Supply Chain",
  "Software, IP & Licensing",
  "Export Control & Sanctions",
  "Competition & Antitrust",
  "Mobility & Rail",
  "Healthcare & MedTech",
  "Employment & Works Council",
  "Corporate Governance & M&A",
  "ESG & Sustainability",
  "Real Estate & Facilities",
  "General Commercial",
];

interface Clause {
  clause_id: string;
  original_clause_id?: string;
  name: string;
  clause_type?: string;
  law_type?: string;
  playbook_id?: string;
  playbook_name?: string;
  playbook_type?: "opposite_party";
  party_name?: string;
  positions?: Record<string, string>;
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

interface PlaybookSummary {
  id: string;
  name: string;
  playbook_type: "opposite_party";
  party_name: string;
  law_type?: string;
  clause_count: number;
}

type ClauseDraft = Pick<
  Clause,
  | "name"
  | "clause_type"
  | "law_type"
  | "positions"
  | "red_line"
  | "escalation_trigger"
  | "always_escalate"
  | "keywords"
>;

interface PlaybookRulesProps {
  readOnly?: boolean;
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

function clauseDraft(clause: Clause): ClauseDraft {
  return {
    name: clause.name ?? "",
    clause_type: clause.clause_type ?? "",
    law_type: clause.law_type ?? "",
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

function normalizeClauseRef(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\da-z]+/g, " ")
    .trim();
}

function identifierCandidates(value: string) {
  return new Set(
    value
      .toLowerCase()
      .match(/[a-z]+-\d+|\d+(?:\.\d+)*/g) ?? []
  );
}

function matchesClauseRef(clause: Clause, clauseRef: string) {
  const normalizedRef = normalizeClauseRef(clauseRef);
  const refIdentifiers = identifierCandidates(clauseRef);

  return [clause.clause_id, clause.original_clause_id, clause.name, clause.clause_type]
    .filter((value): value is string => Boolean(value))
    .some((value) => {
      const normalizedValue = normalizeClauseRef(value);
      const valueIdentifiers = identifierCandidates(value);
      const hasSharedIdentifier = Array.from(valueIdentifiers).some((identifier) =>
        refIdentifiers.has(identifier)
      );
      return (
        hasSharedIdentifier ||
        normalizedRef.includes(normalizedValue) ||
        normalizedValue.includes(normalizedRef)
      );
    });
}

function formatLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function extractRuleNumberParts(value?: string): number[] | null {
  const match = value?.match(/\d+(?:[._-]\d+)*/);
  if (!match) return null;

  const parts = match[0]
    .split(/[._-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  return parts.length > 0 ? parts : null;
}

function clauseRuleNumberParts(clause: Clause): number[] | null {
  const clauseIdSuffix = clause.clause_id.split(/[:/]/).at(-1);
  const candidates = [
    clause.original_clause_id,
    clauseIdSuffix,
    clause.clause_id,
    clause.name,
    clause.clause_type,
  ];

  for (const candidate of candidates) {
    const parts = extractRuleNumberParts(candidate);
    if (parts) return parts;
  }

  return null;
}

function compareNumberParts(a: number[], b: number[]) {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const aPart = a[index] ?? 0;
    const bPart = b[index] ?? 0;
    if (aPart !== bPart) return aPart - bPart;
  }
  return 0;
}

function compareClausesByRuleNumber(a: Clause, b: Clause) {
  const aParts = clauseRuleNumberParts(a);
  const bParts = clauseRuleNumberParts(b);

  if (aParts && bParts) {
    const numberOrder = compareNumberParts(aParts, bParts);
    if (numberOrder !== 0) return numberOrder;
  } else if (aParts) {
    return -1;
  } else if (bParts) {
    return 1;
  }

  return (
    (a.playbook_name ?? "").localeCompare(b.playbook_name ?? "") ||
    (a.name ?? "").localeCompare(b.name ?? "") ||
    a.clause_id.localeCompare(b.clause_id)
  );
}

export default function PlaybookRules({ readOnly = false }: PlaybookRulesProps) {
  const { clearPlaybookClauseSelection, selectedPlaybookClauseRef, userRole } = useAuth();
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [activePlaybookId, setActivePlaybookId] = useState("all");
  const [activeLawType, setActiveLawType] = useState("all");
  const [activePartyName, setActivePartyName] = useState("all");
  const [activeClauseType, setActiveClauseType] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedClause, setSelectedClause] = useState<Clause | null>(null);
  const [draft, setDraft] = useState<ClauseDraft | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [clauseList, playbookList] = await Promise.all([
        apiJson<Clause[]>("/playbook"),
        apiJson<PlaybookSummary[]>("/playbooks"),
      ]);
      setClauses(clauseList);
      setPlaybooks(playbookList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadClause = useCallback(async (clauseId: string) => {
    try {
      const clause = await apiJson<Clause>(`/playbook/${encodeURIComponent(clauseId)}`);
      setSelectedId(clauseId);
      setSelectedClause(clause);
      setDraft(clauseDraft(clause));
      setNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const openClauseFromRef = useCallback(
    (clauseRef: string) => {
      const clause = clauses.find((item) => matchesClauseRef(item, clauseRef));
      if (!clause || selectedId === clause.clause_id) return;
      setActivePlaybookId(clause.playbook_id ?? "all");
      setActiveLawType(clause.law_type ?? "all");
      setActivePartyName(clause.party_name ?? "all");
      setActiveClauseType(clause.clause_type || clause.name || "all");
      clearPlaybookClauseSelection();
      void loadClause(clause.clause_id);
    },
    [clauses, clearPlaybookClauseSelection, loadClause, selectedId]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  useEffect(() => {
    if (!selectedPlaybookClauseRef || clauses.length === 0) return;
    const timeout = window.setTimeout(() => {
      openClauseFromRef(selectedPlaybookClauseRef);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [clauses.length, openClauseFromRef, selectedPlaybookClauseRef]);

  const clauseTypes = useMemo(() => {
    const values = new Set(
      clauses
        .map((clause) => clause.clause_type || clause.name)
        .filter((value): value is string => Boolean(value))
    );
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [clauses]);

  const partyNames = useMemo(() => {
    const values = new Set(
      clauses
        .map((clause) => clause.party_name)
        .filter((value): value is string => Boolean(value))
    );
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [clauses]);

  const lawTypes = useMemo(() => {
    const values = new Set(
      clauses
        .map((clause) => clause.law_type)
        .filter((value): value is string => Boolean(value))
    );
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [clauses]);

  const filteredClauses = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return clauses.filter((clause) => {
      const haystack = [
        clause.clause_id,
        clause.original_clause_id,
        clause.name,
        clause.clause_type,
        clause.law_type,
        clause.playbook_name,
        clause.party_name,
        clause.positions?.preferred,
        clause.red_line,
        ...(clause.keywords ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !needle || haystack.includes(needle);
      const matchesPlaybook =
        activePlaybookId === "all" || clause.playbook_id === activePlaybookId;
      const matchesParty =
        activePartyName === "all" || clause.party_name === activePartyName;
      const matchesLawType =
        activeLawType === "all" || clause.law_type === activeLawType;
      const matchesClauseType =
        activeClauseType === "all" || (clause.clause_type || clause.name) === activeClauseType;
      return (
        matchesSearch &&
        matchesPlaybook &&
        matchesLawType &&
        matchesParty &&
        matchesClauseType
      );
    }).sort(compareClausesByRuleNumber);
  }, [
    activeClauseType,
    activeLawType,
    activePartyName,
    activePlaybookId,
    clauses,
    searchTerm,
  ]);

  function updateDraftField<K extends keyof ClauseDraft>(field: K, value: ClauseDraft[K]) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function updatePositionField(field: "preferred" | "fallback_1" | "fallback_2", value: string) {
    setDraft((current) =>
      current
        ? {
            ...current,
            positions: {
              preferred: current.positions?.preferred ?? "",
              fallback_1: current.positions?.fallback_1 ?? "",
              fallback_2: current.positions?.fallback_2 ?? "",
              [field]: value,
            },
          }
        : current
    );
  }

  async function saveDraft() {
    if (readOnly || !selectedClause || !draft) return;
    setIsSaving(true);
    setNotice(null);
    try {
      const updated = await apiJson<Clause>(
        `/playbook/${encodeURIComponent(selectedClause.clause_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(draft),
        }
      );
      setSelectedClause(updated);
      setDraft(clauseDraft(updated));
      setNotice("Clause updated.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Playbook Rules</h2>
          <p className="text-sm text-muted-foreground">
            {readOnly
              ? "Switch opposite-party playbooks, filter clauses, and view approved fields"
              : "Switch opposite-party playbooks, filter clauses, and update fields"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {filteredClauses.length} of {clauses.length} clauses
          </span>
          {readOnly && (
            <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
              Read-only
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="rounded-lg bg-livebook px-4 py-2 text-sm font-semibold text-white hover:bg-livebook-dark"
          >
            <i className="ri-upload-cloud-2-line mr-2" />
            New playbook
          </button>
        </div>
      </header>

      <div className="shrink-0 space-y-3 border-b border-border bg-card px-6 py-3">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(220px,1fr)_240px_220px_220px_220px]">
          <div className="relative">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search clauses, positions, red lines, keywords..."
              className="w-full rounded-lg border border-border bg-muted/40 py-2 pl-10 pr-4 text-sm text-foreground outline-none transition-all focus:border-livebook focus:ring-2 focus:ring-livebook/20"
            />
          </div>
          <select
            value={activePlaybookId}
            onChange={(event) => setActivePlaybookId(event.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground/80 outline-none focus:border-livebook"
          >
            <option value="all">All playbooks</option>
            {playbooks.map((playbook) => (
              <option key={playbook.id} value={playbook.id}>
                {playbook.name} ({playbook.law_type ?? "General Commercial"})
              </option>
            ))}
          </select>
          <select
            value={activeLawType}
            onChange={(event) => setActiveLawType(event.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground/80 outline-none focus:border-livebook"
          >
            <option value="all">All Livebook law domains</option>
            {lawTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <select
            value={activePartyName}
            onChange={(event) => setActivePartyName(event.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground/80 outline-none focus:border-livebook"
          >
            <option value="all">All opposite parties</option>
            {partyNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={activeClauseType}
            onChange={(event) => setActiveClauseType(event.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground/80 outline-none focus:border-livebook"
          >
            <option value="all">All clause types</option>
            {clauseTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(360px,480px)_1fr]">
        <section className="min-h-0 overflow-y-auto border-r border-border bg-card">
          {isLoading && clauses.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Loading playbooks...</div>
          ) : filteredClauses.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              No clauses match the current filters.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredClauses.map((clause) => (
                <button
                  key={clause.clause_id}
                  type="button"
                  onClick={() => loadClause(clause.clause_id)}
                  className={`w-full px-5 py-4 text-left transition-colors hover:bg-muted/40 ${
                    selectedId === clause.clause_id ? "bg-livebook-pale/60" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{clause.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {clause.positions?.preferred ?? "No preferred position"}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                      {clause.clause_type ?? "General"}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground">
                    <span className="font-mono">{clause.original_clause_id ?? clause.clause_id}</span>
                    <span>{clause.playbook_name ?? "Default Playbook"}</span>
                    <span>{clause.law_type ?? "General Commercial"}</span>
                    <span>{clause.party_name ?? "Opposite party"}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="min-h-0 overflow-y-auto p-6">
          {!selectedClause || !draft ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">
              {readOnly
                ? "Select a clause to view every field."
                : "Select a clause to view and update every field."}
            </div>
          ) : (
            <div className="mx-auto max-w-5xl space-y-5">
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-xs text-muted-foreground">
                      {selectedClause.original_clause_id ?? selectedClause.clause_id}
                    </p>
                    <h1 className="mt-1 text-2xl font-semibold text-foreground">
                      {selectedClause.name}
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedClause.playbook_name ?? "Default Playbook"} ·{" "}
                      {selectedClause.law_type ?? "General Commercial"} ·{" "}
                      {selectedClause.party_name ?? "Opposite party"} · v
                      {selectedClause.meta?.version ?? 1}
                    </p>
                  </div>
                  {readOnly ? (
                    <span className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-semibold text-muted-foreground">
                      Read-only access
                    </span>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setDraft(clauseDraft(selectedClause))}
                        className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={saveDraft}
                        disabled={isSaving}
                        className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        {isSaving ? "Saving..." : "Save changes"}
                      </button>
                    </div>
                  )}
                </div>
                {notice && (
                  <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    {notice}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card p-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Name
                    <input
                      value={draft.name ?? ""}
                      onChange={(event) => updateDraftField("name", event.target.value)}
                      readOnly={readOnly}
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-livebook"
                    />
                  </label>
                  <label className="text-xs font-semibold text-muted-foreground">
                    Clause type
                    <input
                      value={draft.clause_type ?? ""}
                      onChange={(event) => updateDraftField("clause_type", event.target.value)}
                      readOnly={readOnly}
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-livebook"
                    />
                  </label>
                  <label className="text-xs font-semibold text-muted-foreground">
                    Livebook law domain
                    <select
                      value={draft.law_type ?? ""}
                      onChange={(event) => updateDraftField("law_type", event.target.value)}
                      disabled={readOnly}
                      className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-livebook disabled:bg-muted/40"
                    >
                      <option value="">Unassigned</option>
                      {SIEMENS_LAW_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-muted-foreground md:col-span-2">
                    Keywords
                    <input
                      value={(draft.keywords ?? []).join(", ")}
                      onChange={(event) =>
                        updateDraftField(
                          "keywords",
                          event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean)
                        )
                      }
                      readOnly={readOnly}
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-livebook"
                    />
                  </label>
                  {(["preferred", "fallback_1", "fallback_2"] as const).map((field) => (
                    <label key={field} className="text-xs font-semibold text-muted-foreground">
                      {formatLabel(field)}
                      <textarea
                        value={draft.positions?.[field] ?? ""}
                        onChange={(event) => updatePositionField(field, event.target.value)}
                        readOnly={readOnly}
                        className="mt-1 h-28 w-full rounded-lg border border-border px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-livebook"
                      />
                    </label>
                  ))}
                  <label className="text-xs font-semibold text-muted-foreground">
                    Red line
                    <textarea
                      value={draft.red_line ?? ""}
                      onChange={(event) => updateDraftField("red_line", event.target.value)}
                      readOnly={readOnly}
                      className="mt-1 h-28 w-full rounded-lg border border-border px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-livebook"
                    />
                  </label>
                  <label className="text-xs font-semibold text-muted-foreground md:col-span-2">
                    Escalation trigger
                    <textarea
                      value={draft.escalation_trigger ?? ""}
                      onChange={(event) =>
                        updateDraftField("escalation_trigger", event.target.value)
                      }
                      readOnly={readOnly}
                      className="mt-1 h-24 w-full rounded-lg border border-border px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-livebook"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-foreground/80">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.always_escalate)}
                      onChange={(event) =>
                        updateDraftField("always_escalate", event.target.checked)
                      }
                      disabled={readOnly}
                      className="h-4 w-4"
                    />
                    Always escalate
                  </label>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-5">
                <h3 className="font-semibold text-foreground">Source Excerpt</h3>
                <p className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-foreground/80">
                  {selectedClause.raw_source_segment || "No source text available"}
                </p>
              </div>
            </div>
          )}
        </section>
      </main>

      {showUpload && (
        <PlaybookUploadModal
          uploaderRole={userRole === "business" ? "business" : "lawyer"}
          onUploadComplete={() => {
            setShowUpload(false);
            void refresh();
          }}
          onClose={() => setShowUpload(false)}
        />
      )}
    </div>
  );
}
