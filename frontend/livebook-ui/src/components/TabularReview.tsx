"use client";

import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLocale } from "@/app/context/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Notice, PremiumEmpty, StatusBadge, statusTone } from "@/components/premium";
import { localActor } from "@/lib/actorDefaults";
import { cn } from "@/lib/utils";

const API_BASE = "/api/backend";
const ACCEPTED_TYPES =
  "application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx";

type UploadState = "idle" | "uploading" | "success" | "error";

interface TabularReviewSession {
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

interface TabularReviewContract {
  contract_id: string;
  file_name: string;
  counterparty: string;
  matched_clause_count: number;
}

interface TabularReviewRow {
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

interface TabularReviewMetrics {
  contract_count: number;
  matched_clause_count: number;
  average_deviation: number;
  red_line_breaches: number;
  fallback_rows: number;
}

interface Clause {
  clause_id: string;
  name: string;
  positions?: {
    preferred?: string;
    fallback_1?: string;
    fallback_2?: string;
  };
  red_line?: string;
  escalation_trigger?: string;
}

interface TabularReviewProps {
  userRole: "business" | "lawyer";
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
    headers:
      init?.body instanceof FormData
        ? init.headers
        : {
            "content-type": "application/json",
            ...(init?.headers ?? {}),
          },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

function isSupportedFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return (
    file.type === "application/pdf" ||
    lowerName.endsWith(".pdf") ||
    lowerName.endsWith(".docx")
  );
}

type ColumnKey = "contract" | "counterparty" | "clause" | "outcome" | "confidence" | "applied";

const DEFAULT_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  contract: 230,
  counterparty: 230,
  clause: 520,
  outcome: 190,
  confidence: 170,
  applied: 120,
};

const COLUMN_MIN_WIDTHS: Record<ColumnKey, number> = {
  contract: 160,
  counterparty: 170,
  clause: 260,
  outcome: 170,
  confidence: 150,
  applied: 95,
};

export default function TabularReview({ userRole }: TabularReviewProps) {
  const { t, formatDateTime, formatEnumLabel } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef<{ key: ColumnKey; startX: number; startWidth: number } | null>(null);
  const [sessions, setSessions] = useState<TabularReviewSession[]>([]);
  const [activeSession, setActiveSession] = useState<TabularReviewSession | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [selectedClause, setSelectedClause] = useState<Clause | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [columnWidths, setColumnWidths] =
    useState<Record<ColumnKey, number>>(DEFAULT_COLUMN_WIDTHS);
  const [isResizingColumn, setIsResizingColumn] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);

  const refresh = useCallback(async () => {
    try {
      const reviewSessions = await apiJson<TabularReviewSession[]>("/tabular-review");
      const sorted = [...reviewSessions].sort((a, b) => b.created_at.localeCompare(a.created_at));
      setSessions(sorted);
      setError(null);
      setActiveSession((current) => {
        if (current) {
          return sorted.find((session) => session.session_id === current.session_id) ?? current;
        }
        return sorted[0] ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const active = resizeRef.current;
      if (!active) return;
      const minWidth = COLUMN_MIN_WIDTHS[active.key];
      const nextWidth = Math.max(minWidth, active.startWidth + event.clientX - active.startX);
      setColumnWidths((current) => ({ ...current, [active.key]: nextWidth }));
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      setIsResizingColumn(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    if (!isResizingColumn) return;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizingColumn]);

  const rows = useMemo(() => activeSession?.rows ?? [], [activeSession?.rows]);
  const eligibleInsightCount = useMemo(
    () => rows.filter((row) => !row.applied && row.confidence !== "low").length,
    [rows]
  );
  const tableMinWidth = useMemo(
    () => Object.values(columnWidths).reduce((total, width) => total + width, 0),
    [columnWidths]
  );

  const startColumnResize = (event: ReactMouseEvent, key: ColumnKey) => {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      key,
      startX: event.clientX,
      startWidth: columnWidths[key],
    };
    setIsResizingColumn(true);
  };

  const headerCell = (key: ColumnKey, label: string, className = "") => (
    <th className={`relative select-none px-4 py-3 pr-7 ${className}`}>
      <span className="whitespace-nowrap">{label}</span>
      <button
        type="button"
        onMouseDown={(event) => startColumnResize(event, key)}
        className="group absolute right-0 top-0 flex h-full w-5 cursor-col-resize touch-none items-center justify-center gap-0.5 rounded-sm outline-none hover:bg-livebook-pale/60 focus:bg-livebook-pale/60"
        title={`${t("Resize")} ${label}`}
        aria-label={`${t("Resize")} ${label}`}
      >
        <span className="h-4 w-px rounded bg-border transition-colors group-hover:bg-livebook group-focus:bg-livebook" />
        <span className="h-4 w-px rounded bg-border transition-colors group-hover:bg-livebook group-focus:bg-livebook" />
      </button>
    </th>
  );

  const filteredRows = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return rows.filter((row) => {
      const haystack = [
        row.counterparty,
        row.file_name,
        row.clause_name,
        row.clause_type,
        row.outcome,
        row.evidence,
        row.rationale,
      ]
        .join(" ")
        .toLowerCase();
      const matchesSearch = !needle || haystack.includes(needle);
      const matchesOutcome = outcomeFilter === "all" || row.outcome === outcomeFilter;
      const matchesConfidence =
        confidenceFilter === "all" || row.confidence === confidenceFilter;
      return matchesSearch && matchesOutcome && matchesConfidence;
    });
  }, [confidenceFilter, outcomeFilter, rows, searchTerm]);

  const selectedRow = useMemo(
    () => rows.find((row) => row.row_id === selectedRowId) ?? filteredRows[0] ?? null,
    [filteredRows, rows, selectedRowId]
  );

  useEffect(() => {
    if (!selectedRow) {
      const timeout = window.setTimeout(() => {
        setSelectedClause(null);
      }, 0);
      return () => window.clearTimeout(timeout);
    }

    let cancelled = false;
    async function loadClause() {
      try {
        const clause = await apiJson<Clause>(
          `/playbook/${encodeURIComponent(selectedRow.clause_id)}`
        );
        if (!cancelled) setSelectedClause(clause);
      } catch {
        if (!cancelled) setSelectedClause(null);
      }
    }

    void loadClause();
    return () => {
      cancelled = true;
    };
  }, [selectedRow]);

  const getValidFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return null;
    const unsupported = files.find((file) => !isSupportedFile(file));
    if (unsupported) {
      setError(`${unsupported.name}: ${t("Unsupported file. Use PDF or DOCX.")}`);
      setUploadState("error");
      return null;
    }
    setUploadState("idle");
    setError(null);
    setNotice(null);
    return files;
  };

  async function uploadFiles(files: File[]) {
    if (files.length === 0) {
      setError(t("Choose at least one negotiated contract."));
      setUploadState("error");
      return;
    }

    setUploadState("uploading");
    setError(null);
    setNotice(null);

    const formData = new FormData();
    files.forEach((file) => formData.append("file", file));
    formData.append("uploader_role", userRole);
    const actor = localActor(userRole === "business" ? "business" : "lawyer");
    formData.append("uploader_name", actor.display_name);
    formData.append("uploader_email", actor.email);

    try {
      const session = await apiJson<TabularReviewSession>("/tabular-review", {
        method: "POST",
        body: formData,
      });
      setActiveSession(session);
      setSelectedRowId(session.rows[0]?.row_id ?? null);
      setDetailOpen(false);
      setUploadState("success");
      setNotice(
        userRole === "business" && session.escalation_id
          ? t("Deviation found. Escalated to Legal Counsel.")
          : t("Review session created.")
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setUploadState("error");
    }
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

  async function executeApplyInsights(previousSession: TabularReviewSession) {
    if (!activeSession) return;
    setError(null);
    setNotice(null);
    try {
      const updated = await apiJson<TabularReviewSession>(
        `/tabular-review/${encodeURIComponent(activeSession.session_id)}/apply-insights`,
        {
          method: "POST",
          body: JSON.stringify({ include_low_confidence: false }),
        }
      );
      setActiveSession(updated);
      setUndoAction({
        title: t("Undo apply insights"),
        detail: t("Restore the review session and remove the applied negotiation history writebacks."),
        run: async () => {
          const restored = await apiJson<TabularReviewSession>(
            `/tabular-review/${encodeURIComponent(previousSession.session_id)}/restore-insights`,
            {
              method: "POST",
              body: JSON.stringify({ session: previousSession }),
            }
          );
          setActiveSession(restored);
          setNotice(t("Review session and writebacks restored."));
          await refresh();
        },
      });
      setNotice(t("Insights added to negotiation history. Resulting playbook recommendations were sent to the review queue."));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function applyInsights() {
    if (!activeSession) return;
    const previousSession = JSON.parse(JSON.stringify(activeSession)) as TabularReviewSession;
    stageAction({
      title: t("Apply Insights"),
      detail: t("Review and confirm before adding eligible rows to negotiation history and sending recommendations to the review queue."),
      run: () => executeApplyInsights(previousSession),
    });
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="legal-hairline shrink-0 border-b bg-card/92 px-5 py-3 backdrop-blur lg:px-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-livebook-dark">
                {t("Batch contracts")}
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">{t("Batch Review")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("Compare negotiated contracts against the current playbook.")}
              </p>
            </div>

            <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
              <select
                value={activeSession?.session_id ?? ""}
                onChange={(event) => {
                  const session =
                    sessions.find((item) => item.session_id === event.target.value) ?? null;
                  setActiveSession(session);
                  setSelectedRowId(session?.rows[0]?.row_id ?? null);
                  setDetailOpen(false);
                }}
                className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-3 focus:ring-ring/30 sm:w-[min(360px,calc(100vw-5rem))]"
              >
                <option value="">{t("No review session")}</option>
                {sessions.map((session) => (
                  <option key={session.session_id} value={session.session_id}>
                    {formatDateTime(session.created_at)} - {session.metrics.contract_count}{" "}
                    {t("contracts")}
                  </option>
                ))}
              </select>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                multiple
                onChange={(event) => {
                  const files = event.target.files ? getValidFiles(event.target.files) : null;
                  event.currentTarget.value = "";
                  if (files) void uploadFiles(files);
                }}
                className="hidden"
              />
              <Button
                type="button"
                size="icon-lg"
                onClick={() => inputRef.current?.click()}
                disabled={uploadState === "uploading"}
                title={t("Upload files")}
                aria-label={t("Upload files")}
              >
                {uploadState === "uploading" ? (
                  <i className="ri-loader-4-line animate-spin text-base" />
                ) : (
                  <i className="ri-add-line text-base" />
                )}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Metric
              label={t("Contracts")}
              value={activeSession?.metrics.contract_count ?? 0}
              info={t("Number of uploaded contracts in this review session.")}
            />
            <Metric
              label={t("Rows")}
              value={activeSession?.metrics.matched_clause_count ?? 0}
              info={t("Number of extracted clause matches across all uploaded contracts.")}
            />
            <Metric
              label={t("Avg Dev")}
              value={activeSession?.metrics.average_deviation.toFixed(2) ?? "0.00"}
              info={t("Average deviation score across all extracted rows. Higher means the negotiated text differs more from the preferred playbook position.")}
            />
            <Metric
              label={t("Fallbacks")}
              value={activeSession?.metrics.fallback_rows ?? 0}
              info={t("Rows classified as fallback_1 or fallback_2 instead of the preferred position.")}
            />
            <Metric
              label={t("Red Lines")}
              value={activeSession?.metrics.red_line_breaches ?? 0}
              info={t("Rows that breached a red-line position in the current playbook.")}
            />
          </div>
        </div>

        {error ? <Notice tone="danger" className="mt-3">{error}</Notice> : null}
        {notice ? <Notice tone="success" className="mt-3">{notice}</Notice> : null}
        {pendingAction ? (
          <Notice tone="warning" title={t("Confirm action")} className="mt-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-foreground">{pendingAction.title}</p>
                <p>{pendingAction.detail}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button type="button" size="sm" onClick={confirmPendingAction}>
                  {t("Confirm")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={cancelPendingAction}>
                  {t("Cancel")}
                </Button>
              </div>
            </div>
          </Notice>
        ) : null}
        {!pendingAction && undoAction ? (
          <Notice tone="success" title={t("Action confirmed")} className="mt-3">
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
      </header>

      <div
        className={`grid min-h-0 flex-1 grid-cols-1 overflow-hidden ${
          detailOpen && selectedRow ? "xl:grid-cols-[minmax(0,1fr)_minmax(360px,30vw)]" : ""
        }`}
      >
        <main
          className={cn(
            "min-h-0 min-w-0 overflow-hidden",
            detailOpen && selectedRow && "xl:border-r"
          )}
        >
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-card px-6 py-3">
            <div className="grid min-w-[280px] flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_170px_170px]">
              <div className="relative">
                <i className="ri-search-line absolute left-3 top-1/2 text-base -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={t("Search contract, counterparty, clause, evidence...")}
                  className="pl-10"
                />
              </div>
              <Select
                value={outcomeFilter}
                onValueChange={setOutcomeFilter}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("Outcome")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{t("All outcomes")}</SelectItem>
                    <SelectItem value="preferred">{formatEnumLabel("preferred")}</SelectItem>
                    <SelectItem value="fallback_1">{formatEnumLabel("fallback_1")}</SelectItem>
                    <SelectItem value="fallback_2">{formatEnumLabel("fallback_2")}</SelectItem>
                    <SelectItem value="red_line_breached">
                      {formatEnumLabel("red_line_breached")}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select
                value={confidenceFilter}
                onValueChange={setConfidenceFilter}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("Confidence")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{t("All confidence")}</SelectItem>
                    <SelectItem value="high">{formatEnumLabel("high")}</SelectItem>
                    <SelectItem value="medium">{formatEnumLabel("medium")}</SelectItem>
                    <SelectItem value="low">{formatEnumLabel("low")}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {userRole === "lawyer" ? (
              <div className="flex max-w-full shrink-0 items-center gap-2">
                <Button
                  type="button"
                  onClick={applyInsights}
                  disabled={!activeSession || rows.length === 0 || Boolean(activeSession.applied_at) || Boolean(pendingAction)}
                  className="max-w-full shrink-0"
                >
                  <i className="ri-sparkling-line text-base" data-icon="inline-start" />
                  {activeSession?.applied_at ? t("Insights Applied") : t("Apply Insights")}
                </Button>
                <InfoTooltip
                  label={t("About Apply Insights")}
                  content={
                    activeSession?.applied_at
                      ? t("These insights were added to negotiation history. Resulting playbook recommendations were sent to the review queue and still require legal approval before any playbook change happens.")
                      : t("Adds eligible review rows to negotiation history and sends resulting playbook recommendations to the review queue. Low-confidence rows are excluded. This does not change the playbook directly.")
                  }
                />
                {!activeSession?.applied_at && activeSession ? (
                  <span className="text-xs text-muted-foreground">
                    {t("Eligible rows")}: {eligibleInsightCount}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="h-full overflow-auto bg-card">
            {filteredRows.length === 0 ? (
              <div className="flex h-full items-center justify-center p-8">
                <PremiumEmpty
                  icon={<i className="ri-file-search-line text-base" />}
                  title={t("No tabular review rows yet")}
                  description={t("Upload negotiated contracts to compare them against the current playbook.")}
                />
              </div>
            ) : (
              <table
                className="w-full table-fixed border-collapse text-left text-sm"
                style={{ minWidth: tableMinWidth }}
              >
                <colgroup>
                  <col style={{ width: columnWidths.contract }} />
                  <col style={{ width: columnWidths.counterparty }} />
                  <col style={{ width: columnWidths.clause }} />
                  <col style={{ width: columnWidths.outcome }} />
                  <col style={{ width: columnWidths.confidence }} />
                  <col style={{ width: columnWidths.applied }} />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {headerCell("contract", t("Contract"))}
                    {headerCell("counterparty", t("Counterparty"))}
                    {headerCell("clause", t("Clause"))}
                    {headerCell("outcome", t("Outcome"))}
                    {headerCell("confidence", t("Confidence"))}
                    {headerCell("applied", t("Applied"))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredRows.map((row) => (
                    <tr
                      key={row.row_id}
                      onClick={() => {
                        setSelectedRowId(row.row_id);
                        setDetailOpen(true);
                      }}
                      className={cn(
                        "cursor-pointer hover:bg-muted/60",
                        selectedRow?.row_id === row.row_id && "bg-accent/70"
                      )}
                    >
                      <td className="px-4 py-3 align-top text-muted-foreground">
                        {row.file_name}
                      </td>
                      <td className="px-4 py-3 align-top text-muted-foreground">
                        {row.counterparty}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p className="break-words text-pretty font-medium text-foreground">
                          {row.clause_name}
                        </p>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          v{row.playbook_version} - {row.clause_type}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <StatusBadge tone={statusTone(row.outcome)}>
                          {formatEnumLabel(row.outcome)}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <StatusBadge tone={statusTone(row.confidence)}>
                          {formatEnumLabel(row.confidence)}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 align-top text-muted-foreground">
                        {row.applied ? t("Yes") : t("No")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>

        {detailOpen && selectedRow ? (
          <aside className="min-h-0 min-w-0 overflow-y-auto bg-background p-5">
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 rounded-lg border bg-card p-4 shadow-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-muted-foreground">{selectedRow.clause_id}</p>
                  <h3 className="mt-1 text-lg font-semibold text-foreground">
                    {selectedRow.clause_name}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedRow.counterparty} - {selectedRow.file_name}
                    
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setDetailOpen(false)}
                  title={t("Close details")}
                  aria-label={t("Close details")}
                >
                  <i className="ri-close-line text-base" />
                </Button>
              </div>

              <DetailBlock title={t("Contract Evidence")} body={selectedRow.evidence || t("No evidence")} />
              <DetailBlock title={t("Rationale")} body={selectedRow.rationale || t("No rationale")} />

              <div className="rounded-lg border bg-card p-4 shadow-sm">
                <h4 className="mb-3 text-sm font-semibold text-foreground">{t("Playbook Context")}</h4>
                <Field label={t("Preferred")} value={selectedClause?.positions?.preferred} emptyLabel={t("Not set")} />
                <Field label={formatEnumLabel("fallback_1")} value={selectedClause?.positions?.fallback_1} emptyLabel={t("Not set")} />
                <Field label={formatEnumLabel("fallback_2")} value={selectedClause?.positions?.fallback_2} emptyLabel={t("Not set")} />
                <Field label={t("Red Line")} value={selectedClause?.red_line} emptyLabel={t("Not set")} />
                <Field label={t("Escalation")} value={selectedClause?.escalation_trigger} emptyLabel={t("Not set")} />
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function Metric({ label, value, info }: { label: string; value: number | string; info?: string }) {
  return (
    <dl className="flex min-h-12 min-w-[112px] items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
      <dt className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        {info ? <InfoTooltip label={`${label} info`} content={info} /> : null}
      </dt>
      <dd className="text-lg font-semibold text-foreground">{value}</dd>
    </dl>
  );
}

function InfoTooltip({ label, content }: { label: string; content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground transition-colors hover:border-livebook hover:text-livebook focus:outline-none focus:ring-2 focus:ring-ring/40"
          aria-label={label}
        >
          i
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-72 text-pretty leading-relaxed">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

function DetailBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <h4 className="mb-2 text-sm font-semibold text-foreground">{title}</h4>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function Field({ label, value, emptyLabel }: { label: string; value?: string; emptyLabel: string }) {
  return (
    <div className="border-t py-3 first:border-t-0 first:pt-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-foreground/80">{value || emptyLabel}</dd>
    </div>
  );
}
