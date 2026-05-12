"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/app/context/LocaleContext";
import FormattedText from "./FormattedText";
import { Button } from "@/components/ui/button";
import { FilterBar, IconFrame, Notice, PageHeader, PremiumEmpty, StatusBadge } from "@/components/premium";
import { SearchField } from "@/components/premium";
import { cn } from "@/lib/utils";

type QueryStatus = "resolved" | "escalated" | "approved" | "rejected";

interface ChatQueryItem {
  id: string;
  created_at: string;
  question: string;
  answer: string;
  clause_ref: string;
  position_used: string;
  status: QueryStatus;
  next_action: string;
}

export default function PastQueries() {
  const { t, formatDateTime, formatEnumLabel } = useLocale();
  const [queries, setQueries] = useState<ChatQueryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<"all" | QueryStatus>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadQueries() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/backend/chat-queries", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const data = (await response.json()) as ChatQueryItem[];
        if (!cancelled) {
          setQueries(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadQueries();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredQueries = queries.filter((q) => {
    const matchesSearch =
      q.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.answer.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filter === "all" || q.status === filter;
    return matchesSearch && matchesFilter;
  });

  const resolvedCount = queries.filter((q) => q.status === "resolved").length;
  const escalatedCount = queries.filter((q) => q.status === "escalated").length;
  const approvedCount = queries.filter((q) => q.status === "approved").length;
  const rejectedCount = queries.filter((q) => q.status === "rejected").length;

  const statusConfig = {
    resolved: {
      icon: "ri-check-line",
      tone: "success" as const,
      label: formatEnumLabel("resolved"),
    },
    escalated: {
      icon: "ri-arrow-up-line",
      tone: "warning" as const,
      label: formatEnumLabel("escalated"),
    },
    approved: {
      icon: "ri-check-double-line",
      tone: "success" as const,
      label: formatEnumLabel("approved"),
    },
    rejected: {
      icon: "ri-close-line",
      tone: "danger" as const,
      label: formatEnumLabel("rejected"),
    },
  };

  const filterLabels: Record<typeof filter, string> = {
    all: t("All"),
    resolved: formatEnumLabel("resolved"),
    escalated: formatEnumLabel("escalated"),
    approved: formatEnumLabel("approved"),
    rejected: formatEnumLabel("rejected"),
  };

  const formatDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return formatDateTime(date, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <PageHeader
        eyebrow={t("Business guidance")}
        title={t("Past Queries")}
        description={t("Browse previous questions and AI responses across users")}
        meta={
          <>
            <StatusBadge tone="success">
              {resolvedCount} {formatEnumLabel("resolved")}
            </StatusBadge>
            <StatusBadge tone="warning">
              {escalatedCount} {formatEnumLabel("escalated")}
            </StatusBadge>
            <StatusBadge tone="success">
              {approvedCount} {formatEnumLabel("approved")}
            </StatusBadge>
            <StatusBadge tone="danger">
              {rejectedCount} {formatEnumLabel("rejected")}
            </StatusBadge>
          </>
        }
      />

      <FilterBar>
        <SearchField
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder={t("Search questions or AI responses...")}
          className="w-full sm:max-w-md"
        />
        <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {(["all", "resolved", "escalated", "approved", "rejected"] as const).map((f) => (
            <Button
              key={f}
              type="button"
              variant={filter === f ? "default" : "secondary"}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {filterLabels[f]}
            </Button>
          ))}
        </div>
      </FilterBar>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          {error && (
            <Notice tone="danger" title={t("Could not load queries")}>
              {error}
            </Notice>
          )}
          {filteredQueries.length === 0 && (
            <PremiumEmpty
              icon={<i className="ri-search-line text-base" />}
              title={
                loading
                  ? t("Loading queries")
                  : error
                    ? t("Could not load queries")
                    : queries.length === 0
                      ? t("No queries yet")
                      : t("No queries found")
              }
              description={
                queries.length === 0
                    ? t("Ask a question in the Livebook Chat to see it here.")
                    : t("Try adjusting your search or filter criteria.")
              }
              className="min-h-[calc(100vh-19rem)]"
            />
          )}

          {filteredQueries.map((query) => {
            const config = statusConfig[query.status];
            return (
              <div
                key={query.id}
                className="overflow-hidden rounded-lg border border-border/80 bg-card shadow-sm"
              >
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setExpandedId(expandedId === query.id ? null : query.id)
                  }
                  className="h-auto w-full justify-start rounded-none px-5 py-4 text-left hover:bg-muted/40"
                >
                  <IconFrame tone={config.tone} className="mt-0.5">
                    <i className={config.icon} />
                  </IconFrame>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
                        {query.id}
                      </span>
                      <span className="text-xs text-muted-foreground/70">{formatDate(query.created_at)}</span>
                      <StatusBadge tone={config.tone}>{config.label}</StatusBadge>
                    </div>
                    <h3 className="mb-1 break-words text-pretty text-sm font-semibold leading-snug text-foreground">
                      {query.question}
                    </h3>
                  </div>
                  <div className="flex-shrink-0 mt-1">
                    <i
                      className={cn("ri-arrow-down-s-line text-muted-foreground/70 transition-transform", 
                        expandedId === query.id ? "rotate-180" : ""
                      )}
                    />
                  </div>
                </Button>

                {expandedId === query.id && (
                  <div className="px-5 pb-5 pt-2 border-t border-border bg-muted/50">
                    <div className="flex items-start gap-3">
                      <IconFrame tone="accent" className="mt-0.5 size-8">
                        <i className="ri-sparkling-line" />
                      </IconFrame>
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                          {t("AI Response")}
                        </p>
                        <FormattedText text={query.answer} />
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {query.clause_ref && (
                            <StatusBadge tone="neutral">{query.clause_ref}</StatusBadge>
                          )}
                          {query.position_used && (
                            <StatusBadge tone="info">{query.position_used}</StatusBadge>
                          )}
                          {query.next_action && (
                            <Notice tone="accent" className="basis-full">{query.next_action}</Notice>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
