"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "@/app/context/LocaleContext";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Notice, PageHeader, Panel, PremiumEmpty, StatusBadge } from "@/components/premium";
import { diffWords, type VersionDiffRow } from "@/lib/versionDiff";
import { cn } from "@/lib/utils";

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

type PendingAction = {
  title: string;
  detail: string;
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

function formatFieldValue(value: unknown, t: (key: string) => string) {
  if (value === undefined || value === null || value === "") return t("Not set");
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : t("Not set");
  if (typeof value === "boolean") return value ? t("Yes") : t("No");
  return String(value);
}

function diffStatusTone(status: ClauseDiff["status"]) {
  switch (status) {
    case "added":
      return "success" as const;
    case "removed":
      return "danger" as const;
    default:
      return "warning" as const;
  }
}

function highlightCount(parts: Array<{ token: string; changed: boolean }>) {
  return parts.reduce((count, part) => count + (part.changed ? 1 : 0), 0);
}

function DiffDocumentPane({
  label,
  parts,
  tone,
}: {
  label: string;
  parts: Array<{ token: string; changed: boolean }>;
  tone: "previous" | "next";
}) {
  const isPrevious = tone === "previous";
  const count = highlightCount(parts);

  return (
    <div className="rounded-[1.25rem] border border-border/70 bg-background/95 p-4 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.45)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isPrevious ? "bg-red-500" : "bg-emerald-600"
            )}
          />
          {label}
        </p>
        <span
          className={cn(
            "rounded-full px-2 py-1 text-[11px] font-semibold",
            isPrevious ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
          )}
        >
          {count} {count === 1 ? "highlight" : "highlights"}
        </span>
      </div>
      <div
        className={cn(
          "min-h-52 rounded-[1rem] border p-4",
          isPrevious
            ? "border-red-100 bg-red-50/35"
            : "border-emerald-100 bg-emerald-50/45"
        )}
      >
        <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">
          {parts.map((part, index) => (
            <span
              key={`${part.token}-${index}`}
              className={
                part.changed
                  ? isPrevious
                    ? "rounded bg-red-100 px-1 text-red-700 line-through"
                    : "rounded bg-emerald-100 px-1 text-emerald-700"
                  : undefined
              }
            >
              {part.token}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

function DiffRow({
  row,
  selectedLabel,
}: {
  row: VersionDiffRow;
  selectedLabel: string;
}) {
  const { t } = useLocale();
  const diff = diffWords(row.from, row.to);

  return (
    <section className="overflow-hidden rounded-[1.4rem] border border-border/80 bg-gradient-to-br from-muted/60 via-card to-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-livebook-dark">
            {t("Field change")}
          </p>
          <h5 className="mt-1 text-sm font-semibold text-foreground">{row.field}</h5>
        </div>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
          {t("Changed")}
        </span>
      </div>
      <div className="grid gap-4 p-4 xl:grid-cols-2">
        <DiffDocumentPane label={t("Previous")} parts={diff.removed} tone="previous" />
        <DiffDocumentPane label={selectedLabel} parts={diff.added} tone="next" />
      </div>
    </section>
  );
}

function WorkflowSteps({
  currentStep,
  versionLabel,
  clauseLabel,
  reviewDetail,
}: {
  currentStep: number;
  versionLabel: string;
  clauseLabel: string;
  reviewDetail: string;
}) {
  const { t } = useLocale();
  const steps = [
    { label: t("Version"), detail: versionLabel },
    { label: t("Clause"), detail: clauseLabel },
    { label: t("Review"), detail: reviewDetail },
  ];

  return (
    <div className="grid gap-3 border-b border-border/70 px-5 py-4 lg:grid-cols-3">
      {steps.map((step, index) => {
        const isActive = index === currentStep;
        const isComplete = index < currentStep;

        return (
          <div
            key={step.label}
            className={cn(
              "rounded-[1.1rem] border px-4 py-3 transition-colors",
              isActive
                ? "border-livebook bg-livebook-pale/35"
                : isComplete
                  ? "border-emerald-200 bg-emerald-50/40"
                  : "border-border/70 bg-muted/30"
            )}
          >
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  isActive
                    ? "bg-livebook text-white"
                    : isComplete
                      ? "bg-emerald-600 text-white"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {isComplete ? <i className="ri-check-line text-sm" /> : index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {step.label}
                </p>
                <p className="mt-1 truncate text-sm font-semibold text-foreground">{step.detail}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TrustChip({
  icon,
  label,
  tone = "neutral",
}: {
  icon: string;
  label: string;
  tone?: "neutral" | "accent" | "success";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
        tone === "accent" && "border-livebook/20 bg-livebook-pale/50 text-livebook-dark",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "neutral" && "border-border bg-muted/50 text-muted-foreground"
      )}
    >
      <i className={icon} />
      {label}
    </span>
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
  const { t, formatDateTime, formatEnumLabel } = useLocale();
  const timestamp = version.timestamp ? formatDateTime(version.timestamp) : t("Unknown date");

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onOpen(version)}
      className={`h-auto w-full flex-col items-stretch justify-start rounded-lg bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-livebook/30 ${
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
          {version.diff_summary?.changed_clause_count ?? version.changed_clause_ids?.length ?? 0}{" "}
          {t("changes")}
        </span>
      </div>
      <p className="text-sm font-semibold text-foreground">{formatEnumLabel(version.action)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{timestamp}</p>
      <p className="mt-3 font-mono text-[11px] text-muted-foreground">{version.version_id}</p>
    </Button>
  );
}

function ClauseSnapshotCard({ clause }: { clause: Clause }) {
  const { t, formatEnumLabel } = useLocale();

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">
            {clause.original_clause_id ?? clause.clause_id}
          </p>
          <h5 className="mt-1 text-sm font-semibold text-foreground">
            {clause.name ?? t("Unnamed clause")}
          </h5>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
          {formatEnumLabel(clause.meta?.review_status ?? "unknown")}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <p className="text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground/90">{t("Preferred")}:</span>{" "}
          {formatFieldValue(clause.positions?.preferred, t)}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground/90">{formatEnumLabel("fallback_1")}:</span>{" "}
          {formatFieldValue(clause.positions?.fallback_1, t)}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground/90">{formatEnumLabel("fallback_2")}:</span>{" "}
          {formatFieldValue(clause.positions?.fallback_2, t)}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground/90">{t("Always escalate")}:</span>{" "}
          {formatFieldValue(clause.always_escalate, t)}
        </p>
        <p className="text-xs leading-5 text-muted-foreground md:col-span-2">
          <span className="font-semibold text-foreground/90">{t("Red line")}:</span>{" "}
          {formatFieldValue(clause.red_line, t)}
        </p>
        <p className="text-xs leading-5 text-muted-foreground md:col-span-2">
          <span className="font-semibold text-foreground/90">{t("Escalation")}:</span>{" "}
          {formatFieldValue(clause.escalation_trigger, t)}
        </p>
      </div>
    </article>
  );
}

export default function PlaybookHistory({
  canRestore = true,
  audience = "business",
}: PlaybookHistoryProps) {
  void audience;

  const { t, formatDateTime, formatEnumLabel } = useLocale();
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([]);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState("");
  const [versions, setVersions] = useState<PlaybookVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [versionDetail, setVersionDetail] = useState<PlaybookVersion | null>(null);
  const [selectedClauseId, setSelectedClauseId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const snapshotSectionRef = useRef<HTMLElement | null>(null);

  const selectedPlaybook = useMemo(
    () => playbooks.find((playbook) => playbook.id === selectedPlaybookId),
    [playbooks, selectedPlaybookId]
  );

  const activeClause = useMemo(
    () =>
      versionDetail?.diff?.find((clause) => clause.clause_id === selectedClauseId) ??
      versionDetail?.diff?.[0] ??
      null,
    [selectedClauseId, versionDetail]
  );

  const activeClauseSnapshot = useMemo(() => {
    if (!versionDetail || !activeClause) return null;

    return (
      versionDetail.snapshot?.find(
        (clause) =>
          clause.clause_id === activeClause.clause_id ||
          clause.original_clause_id === activeClause.clause_id
      ) ?? null
    );
  }, [activeClause, versionDetail]);

  const activeClauseIndex = useMemo(() => {
    if (!versionDetail?.diff || !activeClause) return -1;
    return versionDetail.diff.findIndex((clause) => clause.clause_id === activeClause.clause_id);
  }, [activeClause, versionDetail]);

  const workflowStep = selectedVersionId
    ? activeClause
      ? 2
      : 1
    : 0;

  const trustSignals = useMemo(() => {
    if (!versionDetail) return [];

    return [
      { icon: "ri-git-branch-line", label: t("Versioned"), tone: "accent" as const },
      { icon: "ri-shield-check-line", label: t("Audit trail"), tone: "neutral" as const },
      {
        icon: "ri-file-list-3-line",
        label: `${versionDetail.snapshot?.length ?? 0} ${t("snapshot clauses")}`,
        tone: "neutral" as const,
      },
      {
        icon: canRestore ? "ri-arrow-go-back-line" : "ri-lock-line",
        label: canRestore ? t("Restore ready") : t("Read only"),
        tone: canRestore ? ("success" as const) : ("neutral" as const),
      },
    ];
  }, [canRestore, t, versionDetail]);

  const openVersion = useCallback(async (version: PlaybookVersion) => {
    setSelectedVersionId(version.version_id);
    setIsLoadingDetail(true);

    try {
      const detail = await apiJson<PlaybookVersion>(
        `/playbooks/${encodeURIComponent(version.playbook_id)}/versions/${encodeURIComponent(
          version.version_id
        )}`
      );

      setVersionDetail(detail);
      setSelectedClauseId((current) => {
        const existing = detail.diff?.find((clause) => clause.clause_id === current);
        if (existing) return existing.clause_id;
        return detail.diff?.[0]?.clause_id ?? detail.snapshot?.[0]?.clause_id ?? "";
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

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

  const loadVersions = useCallback(
    async (playbookId: string, preferredVersionId: string | null = null) => {
      if (!playbookId) {
        setVersions([]);
        setSelectedVersionId("");
        setVersionDetail(null);
        setSelectedClauseId("");
        return;
      }

      setIsLoading(true);

      try {
        const list = await apiJson<PlaybookVersion[]>(
          `/playbooks/${encodeURIComponent(playbookId)}/versions`
        );

        setVersions(list);

        const preferredVersion =
          (preferredVersionId
            ? list.find((version) => version.version_id === preferredVersionId)
            : null) ??
          list[0] ??
          null;

        setSelectedVersionId(preferredVersion?.version_id ?? "");

        if (preferredVersion) {
          void openVersion(preferredVersion);
        } else {
          setVersionDetail(null);
          setSelectedClauseId("");
        }

        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    },
    [openVersion]
  );

  const selectClauseByOffset = useCallback(
    (offset: -1 | 1) => {
      if (!versionDetail?.diff || activeClauseIndex < 0) return;
      const nextIndex = activeClauseIndex + offset;
      const nextClause = versionDetail.diff[nextIndex];
      if (!nextClause) return;
      setSelectedClauseId(nextClause.clause_id);
    },
    [activeClauseIndex, versionDetail]
  );

  const scrollToSnapshot = useCallback(() => {
    snapshotSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const stageAction = useCallback((action: PendingAction) => {
    setError(null);
    setNotice(null);
    setPendingAction(action);
  }, []);

  const restoreVersionSnapshot = useCallback(
    async (version: PlaybookVersion) => {
      await apiJson<Record<string, unknown>>(
        `/playbooks/${encodeURIComponent(version.playbook_id)}/versions/${encodeURIComponent(
          version.version_id
        )}/restore`,
        { method: "POST" }
      );

      setNotice(`${t("Restored")} ${version.label}.`);
      await loadVersions(version.playbook_id, null);
    },
    [loadVersions, t]
  );

  const executeRestoreVersion = useCallback(
    async (version: PlaybookVersion, undoVersion?: PlaybookVersion | null) => {
      await restoreVersionSnapshot(version);
      if (undoVersion) {
        setUndoAction({
          title: t("Undo restore"),
          detail: `${t("Restore")} ${undoVersion.label} ${t("again")}.`,
          run: () => restoreVersionSnapshot(undoVersion),
        });
      } else {
        setUndoAction(null);
      }
    },
    [restoreVersionSnapshot, t]
  );

  const restoreSelectedVersion = useCallback(() => {
    if (!canRestore || !versionDetail) return;
    const latestVersion = versions[0] ?? null;
    const isLatest = latestVersion?.version_id === versionDetail.version_id;
    if (isLatest) return;

    stageAction({
      title: t("Restore this version"),
      detail: `${t("Restore")} ${versionDetail.label} ${t(
        "as a new current playbook version. This does not delete the audit history."
      )}`,
      run: () => executeRestoreVersion(versionDetail, latestVersion),
    });
  }, [canRestore, executeRestoreVersion, stageAction, t, versionDetail, versions]);

  const confirmPendingAction = useCallback(async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);

    try {
      await action.run();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [pendingAction]);

  const cancelPendingAction = useCallback(() => {
    setPendingAction(null);
    setNotice(t("Action cancelled."));
  }, [t]);

  const undoLastAction = useCallback(async () => {
    if (!undoAction) return;
    const action = undoAction;
    setUndoAction(null);

    try {
      await action.run();
      setNotice(t("Undo applied."));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [t, undoAction]);

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

  return (
    <div className="flex h-screen flex-col bg-background">
      <PageHeader
        eyebrow={t("Legal control")}
        title={t("Version History")}
        description={t("Track playbook evolution by selected playbook")}
        actions={
          <>
            <div className="min-w-[14rem] max-w-full">
              <Select
                value={selectedPlaybookId}
                onValueChange={(value) => {
                  setSelectedPlaybookId(value);
                  setSelectedVersionId("");
                  setVersionDetail(null);
                  setSelectedClauseId("");
                }}
              >
                <SelectTrigger className="h-9 w-full bg-background">
                  <SelectValue placeholder={t("Select playbook")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {playbooks.map((playbook) => (
                      <SelectItem key={playbook.id} value={playbook.id}>
                        {playbook.name} ({playbook.clause_count})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <StatusBadge tone="accent">
              {versions.length} {t("Versions")}
            </StatusBadge>
          </>
        }
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
        {error ? (
          <Notice tone="danger" className="mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{error}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadVersions(selectedPlaybookId)}
              >
                {t("Retry")}
              </Button>
            </div>
          </Notice>
        ) : null}

        {notice ? (
          <Notice tone="success" className="mb-4">
            {notice}
          </Notice>
        ) : null}

        {pendingAction ? (
          <Notice tone="warning" className="mb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="font-semibold text-foreground">{pendingAction.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{pendingAction.detail}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={cancelPendingAction}>
                  {t("Cancel")}
                </Button>
                <Button type="button" size="sm" onClick={() => void confirmPendingAction()}>
                  {t("Confirm")}
                </Button>
              </div>
            </div>
          </Notice>
        ) : null}

        {undoAction && !pendingAction ? (
          <Notice tone="accent" className="mb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="font-semibold text-foreground">{undoAction.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{undoAction.detail}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void undoLastAction()}>
                <i className="ri-arrow-go-back-line text-base" data-icon="inline-start" />
                {t("Undo")}
              </Button>
            </div>
          </Notice>
        ) : null}

        {selectedPlaybook ? (
          <Panel className="mb-4" contentClassName="px-4 py-3">
            <span className="font-semibold text-foreground">{selectedPlaybook.name}</span> ·{" "}
            {selectedPlaybook.law_type ?? t("General Commercial")} ·{" "}
            {selectedPlaybook.party_name ?? t("Opposite party")}
          </Panel>
        ) : null}

        {isLoading && versions.length === 0 ? (
          <PremiumEmpty
            icon={<i className="ri-loader-4-line animate-spin text-base" />}
            title={t("Loading version history...")}
            description={t("Track playbook evolution by selected playbook")}
            className="flex-1"
          />
        ) : versions.length === 0 ? (
          <PremiumEmpty
            icon={<i className="ri-git-branch-line text-base" />}
            title={t("No versions yet")}
            description={t("Track playbook evolution by selected playbook")}
            className="flex-1"
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="rounded-lg border border-border bg-muted/70">
              <div className="w-max min-w-full px-6 py-8">
                <div className="relative flex w-max min-w-full items-start gap-8">
                  {versions.length > 1 ? (
                    <div className="absolute left-44 right-44 top-5 h-0.5 bg-border" />
                  ) : null}

                  {versions.map((version) => {
                    const isActive = version.version_id === selectedVersionId;

                    return (
                      <div
                        key={version.version_id}
                        className="relative flex w-[22rem] shrink-0 flex-col items-center"
                      >
                        <div
                          className={cn(
                            "z-10 mb-6 flex h-10 w-10 items-center justify-center rounded-full border-4 bg-card transition-colors",
                            isActive
                              ? "border-livebook text-livebook"
                              : "border-border text-muted-foreground/70"
                          )}
                        >
                          <i className={isActive ? "ri-checkbox-circle-fill" : "ri-circle-line"} />
                        </div>
                        <VersionCard
                          version={version}
                          active={isActive}
                          onOpen={(item) => void openVersion(item)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <section className="mt-6 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
                <div className="border-b border-border bg-card/95 px-5 py-4 backdrop-blur supports-[backdrop-filter]:bg-card/82">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-livebook-dark">
                    {t("Selected version")}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-foreground">
                    {versionDetail?.label ?? t("Loading version...")}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {versionDetail
                      ? `${formatEnumLabel(versionDetail.action)} · ${formatDateTime(versionDetail.timestamp ?? "")}`
                      : t("Choose a version to inspect clause changes.")}
                  </p>
                </div>

                <div className="space-y-4 p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-border/70 bg-muted/40 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("Changed clauses")}
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">
                        {versionDetail?.diff?.length ?? 0}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-muted/40 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("Snapshot clauses")}
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">
                        {versionDetail?.snapshot?.length ?? 0}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-[1.25rem] border border-border/70 bg-muted/35 p-3">
                    <div className="mb-3 flex items-center gap-2">
                      <i className="ri-git-compare-line text-livebook" />
                      <h4 className="text-sm font-semibold text-foreground">{t("Clause changes")}</h4>
                    </div>

                    {isLoadingDetail && !versionDetail ? (
                      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                        <i className="ri-loader-4-line animate-spin text-base" />
                        {t("Loading version...")}
                      </div>
                    ) : !versionDetail?.diff || versionDetail.diff.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                        {t("No tracked clause changes for this version.")}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {versionDetail.diff.map((clause) => {
                          const isActive = clause.clause_id === activeClause?.clause_id;

                          return (
                            <button
                              key={`${clause.clause_id}-${clause.status}`}
                              type="button"
                              onClick={() => setSelectedClauseId(clause.clause_id)}
                              className={cn(
                                "w-full rounded-2xl border px-3 py-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm",
                                isActive
                                  ? "border-livebook bg-livebook-pale/45 shadow-sm"
                                  : "border-border/70 bg-background"
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                                    {clause.clause_id}
                                  </p>
                                  <p className="mt-1 truncate text-sm font-semibold text-foreground">
                                    {clause.name}
                                  </p>
                                </div>
                                <StatusBadge tone={diffStatusTone(clause.status)}>
                                  {formatEnumLabel(clause.status)}
                                </StatusBadge>
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">
                                {clause.changed_fields.length} {t("fields changed")}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </aside>

              <section className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
                <div className="border-b border-border bg-card/95 px-5 py-4 backdrop-blur supports-[backdrop-filter]:bg-card/82">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-livebook-dark">
                        {t("Version diff")}
                      </p>
                      <h3 className="mt-1 truncate text-lg font-semibold text-foreground">
                        {activeClause?.name ?? t("Select a changed clause")}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {activeClause?.clause_id ?? t("Version changes appear here.")}
                      </p>
                    </div>
                    {activeClause ? (
                      <StatusBadge tone={diffStatusTone(activeClause.status)}>
                        {formatEnumLabel(activeClause.status)}
                      </StatusBadge>
                    ) : null}
                  </div>
                </div>

                <WorkflowSteps
                  currentStep={workflowStep}
                  versionLabel={versionDetail?.label ?? t("Select a version")}
                  clauseLabel={activeClause?.name ?? t("Select a changed clause")}
                  reviewDetail={
                    activeClause
                      ? `${activeClause.changed_fields.length} ${t("fields changed")}`
                      : t("Version changes appear here.")
                  }
                />

                <div className="space-y-5 p-5">
                  {isLoadingDetail && !versionDetail ? (
                    <PremiumEmpty
                      icon={<i className="ri-loader-4-line animate-spin text-base" />}
                      title={t("Loading version...")}
                      description={t("Track playbook evolution by selected playbook")}
                      className="min-h-72"
                    />
                  ) : !versionDetail ? (
                      <PremiumEmpty
                        icon={<i className="ri-git-compare-line text-base" />}
                        title={t("Select a version")}
                      description={t("Choose a version to inspect clause changes.")}
                      className="min-h-72"
                    />
                  ) : !activeClause ? (
                    <>
                      <PremiumEmpty
                        icon={<i className="ri-git-compare-line text-base" />}
                        title={t("No tracked clause changes for this version.")}
                        description={t("Full playbook snapshot")}
                        className="min-h-72"
                      />
                      <section>
                        <div className="mb-3 flex items-center gap-2">
                          <i className="ri-book-open-line text-livebook"></i>
                          <h4 className="text-sm font-semibold text-foreground">
                            {t("Full playbook snapshot")}
                          </h4>
                        </div>
                        <div className="space-y-3">
                          {(versionDetail.snapshot ?? []).map((clause) => (
                            <ClauseSnapshotCard key={clause.clause_id} clause={clause} />
                          ))}
                        </div>
                      </section>
                    </>
                  ) : (
                    <>
                      <section className="rounded-[1.25rem] border border-border/70 bg-muted/30 p-4">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                          <div className="flex flex-wrap gap-2">
                            {trustSignals.map((signal) => (
                              <TrustChip
                                key={`${signal.icon}-${signal.label}`}
                                icon={signal.icon}
                                label={signal.label}
                                tone={signal.tone}
                              />
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => selectClauseByOffset(-1)}
                              disabled={activeClauseIndex <= 0}
                            >
                              <i className="ri-arrow-left-line text-base" data-icon="inline-start" />
                              {t("Previous")}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => selectClauseByOffset(1)}
                              disabled={
                                activeClauseIndex < 0 ||
                                activeClauseIndex >= (versionDetail.diff?.length ?? 0) - 1
                              }
                            >
                              {t("Next")}
                              <i className="ri-arrow-right-line text-base" data-icon="inline-end" />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={scrollToSnapshot}
                            >
                              <i className="ri-book-open-line text-base" data-icon="inline-start" />
                              {t("Full playbook snapshot")}
                            </Button>
                            {canRestore ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={restoreSelectedVersion}
                                disabled={
                                  !versionDetail ||
                                  versions[0]?.version_id === versionDetail.version_id ||
                                  Boolean(pendingAction)
                                }
                              >
                                <i
                                  className="ri-arrow-go-back-line text-base"
                                  data-icon="inline-start"
                                />
                                {t("Restore this version")}
                              </Button>
                            ) : null}
                            {versions[0] && versions[0].version_id !== versionDetail.version_id ? (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => void openVersion(versions[0])}
                              >
                                <i className="ri-sparkling-line text-base" data-icon="inline-start" />
                                {t("Latest version")}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </section>

                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
                        <div className="rounded-[1.25rem] border border-border/70 bg-gradient-to-br from-slate-50 via-background to-emerald-50/30 p-4">
                          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-livebook-dark">
                            {t("Comparison workspace")}
                          </p>
                          <h4 className="mt-2 text-sm font-semibold text-foreground">
                            {activeClause.name}
                          </h4>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {t("Review the previous clause text against the selected version.")}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-[1.25rem] border border-border/70 bg-muted/35 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {t("Fields changed")}
                            </p>
                            <p className="mt-2 text-2xl font-semibold text-foreground">
                              {activeClause.changed_fields.length}
                            </p>
                          </div>
                          <div className="rounded-[1.25rem] border border-border/70 bg-muted/35 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {t("Version")}
                            </p>
                            <p className="mt-2 text-2xl font-semibold text-foreground">
                              {versionDetail.label}
                            </p>
                          </div>
                        </div>
                      </div>

                      {activeClause.changed_fields.length === 0 ? (
                        <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                          {t("Clause")} {formatEnumLabel(activeClause.status)}.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {activeClause.changed_fields.map((row) => (
                            <DiffRow key={row.field} row={row} selectedLabel={t("This version")} />
                          ))}
                        </div>
                      )}

                      {activeClauseSnapshot ? (
                        <section>
                          <div className="mb-3 flex items-center gap-2">
                            <i className="ri-file-list-3-line text-livebook"></i>
                            <h4 className="text-sm font-semibold text-foreground">
                              {t("Selected clause snapshot")}
                            </h4>
                          </div>
                          <ClauseSnapshotCard clause={activeClauseSnapshot} />
                        </section>
                      ) : null}

                      <section ref={snapshotSectionRef}>
                        <div className="mb-3 flex items-center gap-2">
                          <i className="ri-book-open-line text-livebook"></i>
                          <h4 className="text-sm font-semibold text-foreground">
                            {t("Full playbook snapshot")}
                          </h4>
                        </div>
                        <div className="space-y-3">
                          {(versionDetail.snapshot ?? []).map((clause) => (
                            <ClauseSnapshotCard key={clause.clause_id} clause={clause} />
                          ))}
                        </div>
                      </section>
                    </>
                  )}
                </div>
              </section>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
