"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../app/context/AuthContext";
import { useLocale } from "@/app/context/LocaleContext";
import PlaybookUploadModal from "./PlaybookUploadModal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FilterBar, Notice, PageHeader, Panel, PremiumEmpty, SearchField, StatusBadge } from "@/components/premium";
import { cn } from "@/lib/utils";

const API_BASE = "/api/backend";
const LAW_DOMAINS = [
  "Commercial Contracts",
  "Procurement & Supply Chain",
  "Software, IP & Licensing",
  "Data Privacy & Cybersecurity",
  "AI Governance",
  "Termination & Exit",
  "Liability & Indemnification",
  "Security & Compliance",
  "Export Control & Sanctions",
  "Employment",
  "Corporate Governance & M&A",
  "Real Estate & Facilities",
  "Healthcare & Life Sciences",
  "Financial Services",
  "ESG & Sustainability",
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

type PendingAction = {
  title: string;
  detail: string;
  confirmLabel?: string;
  run: () => Promise<void> | void;
};

type UndoAction = {
  title: string;
  detail: string;
  run: () => Promise<void> | void;
};

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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
  const { t, formatEnumLabel } = useLocale();
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
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);

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
      setPendingAction(null);
      setUndoAction(null);
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

  function stageAction(action: PendingAction) {
    setUndoAction(null);
    setPendingAction(action);
  }

  function confirmPendingAction() {
    const action = pendingAction;
    if (!action) return;
    setPendingAction(null);
    void Promise.resolve(action.run()).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }

  function cancelPendingAction() {
    if (pendingAction) {
      setNotice(t("Action canceled."));
    }
    setPendingAction(null);
  }

  function undoLastAction() {
    const action = undoAction;
    if (!action) return;
    setUndoAction(null);
    void Promise.resolve(action.run()).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }

  function resetDraft() {
    if (readOnly || !selectedClause || !draft) return;
    const previousDraft = cloneJson(draft);
    stageAction({
      title: t("Reset draft"),
      detail: t("Review reset before replacing unsaved fields with the last saved clause."),
      run: () => {
        setDraft(clauseDraft(selectedClause));
        setNotice(t("Draft reset."));
        setUndoAction({
          title: t("Undo reset"),
          detail: t("Restore the unsaved fields from before reset."),
          run: () => {
            setDraft(previousDraft);
            setNotice(t("Reset undone."));
          },
        });
      },
    });
  }

  async function restoreClause(previousClause: Clause) {
    setIsSaving(true);
    setNotice(null);
    try {
      const restored = await apiJson<Clause>(
        `/playbook/${encodeURIComponent(previousClause.clause_id)}/restore-snapshot`,
        {
          method: "POST",
          body: JSON.stringify(previousClause),
        }
      );
      setSelectedClause(restored);
      setDraft(clauseDraft(restored));
      setNotice(t("Clause restored."));
      await refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function commitDraft(previousClause: Clause) {
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
      setNotice(t("Clause updated."));
      setUndoAction({
        title: t("Undo save"),
        detail: t("Restore this clause to the previous saved fields."),
        run: () => restoreClause(previousClause),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  function saveDraft() {
    if (readOnly || !selectedClause || !draft) return;
    const previousClause = cloneJson(selectedClause);
    stageAction({
      title: t("Save clause"),
      detail: t("Review changed playbook fields before writing them to the backend."),
      confirmLabel: t("Confirm"),
      run: () => commitDraft(previousClause),
    });
  }

  const draftLawTypeValue = draft?.law_type || "__unassigned";
  const formLocked = readOnly || Boolean(pendingAction);

  return (
    <div className="flex h-screen flex-col bg-background">
      <PageHeader
        eyebrow={t("Legal control")}
        title={t("Playbook Rules")}
        description={
          readOnly
            ? t("Switch opposite-party playbooks, filter clauses, and view approved fields")
            : t("Switch opposite-party playbooks, filter clauses, and update fields")
        }
        actions={
          <>
            <StatusBadge tone="neutral">
              {filteredClauses.length} / {clauses.length} {t("Clauses")}
            </StatusBadge>
            {readOnly ? <StatusBadge tone="warning">{t("Read-only")}</StatusBadge> : null}
            <Button type="button" onClick={() => setShowUpload(true)}>
              <i className="ri-upload-cloud-2-line" data-icon="inline-start" />
              {t("New playbook")}
            </Button>
          </>
        }
      />

      <FilterBar className="flex flex-col gap-3">
        <div className="grid w-full min-w-0 grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-[minmax(220px,1fr)_240px_220px_220px_220px]">
          <SearchField
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder={t("Search clauses, positions, red lines, keywords...")}
          />
          <Select value={activePlaybookId} onValueChange={setActivePlaybookId}>
            <SelectTrigger className="h-9 w-full bg-background">
              <SelectValue placeholder={t("All playbooks")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t("All playbooks")}</SelectItem>
                {playbooks.map((playbook) => (
                  <SelectItem key={playbook.id} value={playbook.id}>
                    {playbook.name} ({playbook.law_type ?? t("General Commercial")})
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={activeLawType} onValueChange={setActiveLawType}>
            <SelectTrigger className="h-9 w-full bg-background">
              <SelectValue placeholder={t("All Livebook law domains")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t("All Livebook law domains")}</SelectItem>
                {lawTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={activePartyName} onValueChange={setActivePartyName}>
            <SelectTrigger className="h-9 w-full bg-background">
              <SelectValue placeholder={t("All opposite parties")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t("All opposite parties")}</SelectItem>
                {partyNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={activeClauseType} onValueChange={setActiveClauseType}>
            <SelectTrigger className="h-9 w-full bg-background">
              <SelectValue placeholder={t("All clause types")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t("All clause types")}</SelectItem>
                {clauseTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </FilterBar>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(360px,480px)_1fr]">
        <section className="min-h-0 overflow-y-auto border-r border-border bg-card/92">
          {isLoading && clauses.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">{t("Loading playbooks...")}</div>
          ) : filteredClauses.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6">
              <PremiumEmpty
                icon={<i className="ri-book-open-line text-base" />}
                title={t("No clauses match the current filters.")}
                description={t("Try adjusting your search or filter criteria.")}
                className="w-full"
              />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredClauses.map((clause) => (
                <Button
                  key={clause.clause_id}
                  type="button"
                  variant="ghost"
                  onClick={() => loadClause(clause.clause_id)}
                  className={cn(
                    "h-auto w-full flex-col items-stretch justify-start rounded-none px-5 py-4 text-left hover:bg-muted/40",
                    selectedId === clause.clause_id && "bg-livebook-pale/70 text-livebook-dark"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{clause.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {clause.positions?.preferred ?? t("No preferred position")}
                      </p>
                    </div>
                    <StatusBadge tone="neutral" className="shrink-0">
                      {clause.clause_type ?? t("General")}
                    </StatusBadge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground">
                    <span className="font-mono">{clause.original_clause_id ?? clause.clause_id}</span>
                    <span>{clause.playbook_name?.trim() || t("Untitled playbook")}</span>
                    <span>{clause.law_type ?? t("General Commercial")}</span>
                    <span>{clause.party_name ?? t("Opposite party")}</span>
                  </div>
                </Button>
              ))}
            </div>
          )}
        </section>

        <section className="min-h-0 overflow-y-auto p-6">
          {!selectedClause || !draft ? (
            <PremiumEmpty
              icon={<i className="ri-file-list-3-line text-base" />}
              title={readOnly ? t("Select a clause to view every field.") : t("Select a clause to view and update every field.")}
              description={t("Use filters on the left to narrow the playbook rules.")}
              className="h-full"
            />
          ) : (
            <div className="mx-auto flex max-w-5xl flex-col gap-5">
              <Panel
                contentClassName="p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-xs text-muted-foreground">
                      {selectedClause.original_clause_id ?? selectedClause.clause_id}
                    </p>
                    <h1 className="mt-1 text-2xl font-semibold text-foreground">
                      {selectedClause.name}
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedClause.playbook_name?.trim() || t("Untitled playbook")} ·{" "}
                      {selectedClause.law_type ?? t("General Commercial")} ·{" "}
                      {selectedClause.party_name ?? t("Opposite party")} · v
                      {selectedClause.meta?.version ?? 1}
                    </p>
                  </div>
                  {readOnly ? (
                    <StatusBadge tone="warning">{t("Read-only")}</StatusBadge>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={resetDraft}
                        disabled={Boolean(pendingAction)}
                      >
                        {t("Reset")}
                      </Button>
                      <Button
                        type="button"
                        onClick={saveDraft}
                        disabled={isSaving || Boolean(pendingAction)}
                      >
                        {isSaving ? `${t("Save")}...` : t("Save")}
                      </Button>
                    </div>
                  )}
                </div>
                {notice ? <Notice tone="success" className="mt-4">{notice}</Notice> : null}
                {pendingAction ? (
                  <Notice tone="warning" title={t("Confirm action")} className="mt-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium text-foreground">{pendingAction.title}</p>
                        <p>{pendingAction.detail}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button type="button" size="sm" onClick={confirmPendingAction}>
                          {pendingAction.confirmLabel ?? t("Confirm")}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={cancelPendingAction}>
                          {t("Cancel")}
                        </Button>
                      </div>
                    </div>
                  </Notice>
                ) : null}
                {!pendingAction && undoAction ? (
                  <Notice tone="success" title={t("Action confirmed")} className="mt-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium text-foreground">{undoAction.title}</p>
                        <p>{undoAction.detail}</p>
                      </div>
                      <Button type="button" size="sm" variant="secondary" onClick={undoLastAction}>
                        {t("Undo")}
                      </Button>
                    </div>
                  </Notice>
                ) : null}
              </Panel>

              <Panel>
                <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>{t("Name")}</FieldLabel>
                    <Input
                      value={draft.name ?? ""}
                      onChange={(event) => updateDraftField("name", event.target.value)}
                      readOnly={formLocked}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>
                      {t("Clause type")}
                    </FieldLabel>
                    <Input
                      value={draft.clause_type ?? ""}
                      onChange={(event) => updateDraftField("clause_type", event.target.value)}
                      readOnly={formLocked}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>{t("Domain")}</FieldLabel>
                    <Select
                      value={draftLawTypeValue}
                      onValueChange={(value) =>
                        updateDraftField("law_type", value === "__unassigned" ? "" : value)
                      }
                      disabled={formLocked}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="__unassigned">{t("Not set")}</SelectItem>
                          {LAW_DOMAINS.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field className="md:col-span-2">
                    <FieldLabel>{t("Keywords")}</FieldLabel>
                    <Input
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
                      readOnly={formLocked}
                    />
                  </Field>
                  {(["preferred", "fallback_1", "fallback_2"] as const).map((field) => (
                    <Field key={field}>
                      <FieldLabel>{formatEnumLabel(field)}</FieldLabel>
                      <Textarea
                        value={draft.positions?.[field] ?? ""}
                        onChange={(event) => updatePositionField(field, event.target.value)}
                        readOnly={formLocked}
                        className="min-h-28"
                      />
                    </Field>
                  ))}
                  <Field>
                    <FieldLabel>{t("Red line")}</FieldLabel>
                    <Textarea
                      value={draft.red_line ?? ""}
                      onChange={(event) => updateDraftField("red_line", event.target.value)}
                      readOnly={formLocked}
                      className="min-h-28"
                    />
                  </Field>
                  <Field className="md:col-span-2">
                    <FieldLabel>{t("Escalation trigger")}</FieldLabel>
                    <Textarea
                      value={draft.escalation_trigger ?? ""}
                      onChange={(event) =>
                        updateDraftField("escalation_trigger", event.target.value)
                      }
                      readOnly={formLocked}
                      className="min-h-24"
                    />
                  </Field>
                  <Field orientation="horizontal" className="md:col-span-2">
                    <Checkbox
                      checked={Boolean(draft.always_escalate)}
                      onCheckedChange={(checked) =>
                        updateDraftField("always_escalate", checked === true)
                      }
                      disabled={formLocked}
                    />
                    <FieldContent>
                      <FieldTitle>{t("Always escalate")}</FieldTitle>
                    </FieldContent>
                  </Field>
                </FieldGroup>
              </Panel>

              <Panel title={t("Source Excerpt")}>
                <p className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-foreground/80">
                  {selectedClause.raw_source_segment || t("No source text available")}
                </p>
              </Panel>
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
