"use client";

import { useEffect, useState } from "react";
import FormattedText from "./FormattedText";

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
      iconColor: "text-green-600",
      bg: "bg-green-50",
      badge: "text-green-700 bg-green-50 border-green-200",
      label: "Resolved",
    },
    escalated: {
      icon: "ri-arrow-up-line",
      iconColor: "text-amber-600",
      bg: "bg-amber-50",
      badge: "text-amber-700 bg-amber-50 border-amber-200",
      label: "Escalated",
    },
    approved: {
      icon: "ri-check-double-line",
      iconColor: "text-green-600",
      bg: "bg-green-50",
      badge: "text-green-700 bg-green-50 border-green-200",
      label: "Approved",
    },
    rejected: {
      icon: "ri-close-line",
      iconColor: "text-red-600",
      bg: "bg-red-50",
      badge: "text-red-700 bg-red-50 border-red-200",
      label: "Rejected",
    },
  };

  const formatDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Past Queries</h2>
          <p className="text-sm text-muted-foreground">
            Browse previous questions and AI responses across users
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-full border border-green-200">
            {resolvedCount} Resolved
          </span>
          <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
            {escalatedCount} Escalated
          </span>
          <span className="text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-full border border-green-200">
            {approvedCount} Approved
          </span>
          <span className="text-xs font-medium text-red-700 bg-red-50 px-2.5 py-1 rounded-full border border-red-200">
            {rejectedCount} Rejected
          </span>
        </div>
      </header>

      {/* Filters */}
      <div className="bg-card border-b border-border px-6 py-3 flex items-center gap-4 flex-shrink-0">
        <div className="relative flex-1 max-w-md">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70"></i>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search questions or AI responses..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-muted/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-livebook/20 focus:border-livebook transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          {(["all", "resolved", "escalated", "approved", "rejected"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-livebook text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {f === "all" ? "All" : f === "resolved" ? "Resolved" : f === "escalated" ? "Escalated" : f === "approved" ? "Approved" : "Rejected"}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-3">
          {filteredQueries.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-3">
                <i className="ri-search-line text-xl text-muted-foreground/70"></i>
              </div>
              <h3 className="text-base font-semibold text-foreground mb-1">
                {loading ? "Loading queries" : error ? "Could not load queries" : queries.length === 0 ? "No queries yet" : "No queries found"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {error
                  ? error
                  : queries.length === 0
                  ? "Ask a question in the Livebook Chat to see it here."
                  : "Try adjusting your search or filter criteria."}
              </p>
            </div>
          )}

          {filteredQueries.map((query) => {
            const config = statusConfig[query.status];
            return (
              <div
                key={query.id}
                className="bg-card rounded-xl border border-border shadow-sm overflow-hidden"
              >
                <button
                  onClick={() =>
                    setExpandedId(expandedId === query.id ? null : query.id)
                  }
                  className="w-full px-5 py-4 flex items-start gap-4 text-left hover:bg-muted/40 transition-colors"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center ${config.bg}`}
                    >
                      <i
                        className={`${config.icon} ${config.iconColor} text-sm`}
                      ></i>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
                        {query.id}
                      </span>
                      <span className="text-xs text-muted-foreground/70">{formatDate(query.created_at)}</span>
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full border ${config.badge}`}
                      >
                        {config.label}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-foreground leading-snug mb-1">
                      {query.question}
                    </h3>
                  </div>
                  <div className="flex-shrink-0 mt-1">
                    <i
                      className={`ri-arrow-down-s-line text-muted-foreground/70 transition-transform ${
                        expandedId === query.id ? "rotate-180" : ""
                      }`}
                    ></i>
                  </div>
                </button>

                {expandedId === query.id && (
                  <div className="px-5 pb-5 pt-2 border-t border-border bg-muted/50">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-livebook-pale flex items-center justify-center mt-0.5">
                        <i className="ri-sparkling-line text-livebook text-sm"></i>
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                          AI Response
                        </p>
                        <FormattedText text={query.answer} />
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {query.clause_ref && (
                            <span className="rounded border bg-card px-2 py-1">{query.clause_ref}</span>
                          )}
                          {query.position_used && (
                            <span className="rounded border bg-card px-2 py-1">{query.position_used}</span>
                          )}
                          {query.next_action && (
                            <span className="basis-full rounded border bg-card px-2 py-1">{query.next_action}</span>
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
