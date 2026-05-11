"use client";

export interface HistoryNodeData {
  id: string;
  clauseId: string;
  clauseName: string;
  version: string;
  versionNumber: number;
  versionId?: string;
  previousVersionId?: string;
  date: string;
  timestampLabel: string;
  author: string;
  action: string;
  summary: string;
  isActive: boolean;
  isCurrent: boolean;
  snapshot: Record<string, unknown>;
}

interface HistoryNodeProps {
  data: HistoryNodeData;
  canRevert: boolean;
  isReverting?: boolean;
  onViewOverview: (data: HistoryNodeData) => void;
  onRevert: (data: HistoryNodeData) => void;
}

export default function HistoryNode({
  data,
  canRevert,
  isReverting = false,
  onViewOverview,
  onRevert,
}: HistoryNodeProps) {
  const showActionBadge = data.action === "restore";
  const openVersion = () => onViewOverview(data);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openVersion();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openVersion}
      onKeyDown={handleKeyDown}
      aria-label={`View ${data.version} for ${data.clauseName}`}
      className={`w-full cursor-pointer rounded-lg bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-livebook/30 ${
        data.isActive
          ? "border-2 border-livebook border-l-4 border-l-livebook ring-2 ring-livebook/20"
          : "border border-border border-l-4 border-l-slate-300"
      }`}
    >
      <div className="p-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="w-fit rounded bg-livebook-pale px-2.5 py-1 font-mono text-xs font-bold text-livebook-dark">
              {data.version}
            </span>
            {data.versionId && (
              <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                {data.versionId}
              </span>
            )}
          </div>
          {showActionBadge && (
            <span className="flex items-center gap-1 text-xs font-medium text-livebook">
              <i className="ri-checkbox-circle-fill"></i>
              restore
            </span>
          )}
        </div>

        <p className="mb-1 text-sm font-semibold text-foreground">
          {data.clauseName}
        </p>
        <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <i className="ri-time-line"></i>
          {data.timestampLabel}: {data.date}
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          {data.author}
        </p>

        <p className="mb-4 text-sm leading-relaxed text-foreground/80">
          {data.summary}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openVersion();
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-livebook"
          >
            <i className="ri-file-list-3-line"></i>
            View version
          </button>

          {canRevert && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRevert(data);
              }}
              disabled={isReverting}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-livebook disabled:cursor-not-allowed disabled:opacity-60"
            >
              <i className={isReverting ? "ri-loader-4-line animate-spin" : "ri-arrow-go-back-line"}></i>
              {isReverting ? "Restoring..." : "Restore this version"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
