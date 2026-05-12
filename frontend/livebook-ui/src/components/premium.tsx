import type React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type StatusTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "accent";

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-border bg-secondary text-secondary-foreground",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  accent: "border-teal-200 bg-teal-50 text-teal-900",
};

const statusIconClasses: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-emerald-600",
  warning: "text-amber-600",
  danger: "text-red-600",
  info: "text-sky-600",
  accent: "text-livebook",
};

export function statusTone(value?: string): StatusTone {
  const key = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[ -]+/g, "_");
  if (
    key === "rejected" ||
    key === "failed" ||
    key === "escalated" ||
    key === "red_line_breached"
  ) {
    return "danger";
  }
  if (
    key === "pending" ||
    key === "pending_review" ||
    key === "review_pending" ||
    key === "fallback_1" ||
    key === "fallback_2" ||
    key === "low"
  ) {
    return "warning";
  }
  if (
    key === "approved" ||
    key === "preferred" ||
    key === "resolved" ||
    key === "high" ||
    key === "ok"
  ) {
    return "success";
  }
  if (key === "evolve_suggestion" || key === "suggestion" || key === "medium") {
    return "info";
  }
  return "neutral";
}

export function StatusBadge({
  children,
  tone,
  className,
}: {
  children: React.ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  const resolvedTone = tone ?? statusTone(String(children ?? ""));
  return (
    <Badge
      variant="outline"
      className={cn("border font-semibold", toneClasses[resolvedTone], className)}
    >
      {children}
    </Badge>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "legal-hairline shrink-0 border-b bg-card/92 px-5 py-4 backdrop-blur supports-[backdrop-filter]:bg-card/82 lg:px-6",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-livebook-dark">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
          ) : null}
          {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function MetricTile({
  label,
  value,
  icon,
  tone = "neutral",
  detail,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tone?: StatusTone;
  detail?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("border-border/80 bg-card shadow-none", className)}>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
          {detail ? <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p> : null}
        </div>
        {icon ? (
          <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted", statusIconClasses[tone])}>
            {icon}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("border-border/80 bg-card shadow-none", className)}>
      {(title || description || actions) && (
        <CardHeader className="flex flex-row items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            {title ? <CardTitle className="text-base">{title}</CardTitle> : null}
            {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </CardHeader>
      )}
      <CardContent className={cn("p-5", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

export function FilterBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "legal-hairline shrink-0 border-b bg-card/92 px-5 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/82 lg:px-6",
        className
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export function SearchField({
  className,
  inputClassName,
  ...props
}: React.ComponentProps<typeof Input> & {
  inputClassName?: string;
}) {
  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-base text-muted-foreground/70" />
      <Input className={cn("pl-10", inputClassName)} {...props} />
    </div>
  );
}

export function IconFrame({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted",
        statusIconClasses[tone],
        className
      )}
    >
      {children}
    </div>
  );
}

export function PremiumEmpty({
  title,
  description,
  icon,
  className,
}: {
  title: string;
  description: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("min-h-64 border border-dashed border-border/80 bg-card", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {icon}
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function Notice({
  title,
  children,
  tone = "neutral",
  className,
}: {
  title?: string;
  children: React.ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  const iconClass =
    tone === "danger"
      ? "ri-error-warning-line"
      : tone === "success"
        ? "ri-checkbox-circle-line"
        : tone === "warning"
          ? "ri-time-line"
          : tone === "accent"
            ? "ri-sparkling-line"
            : "ri-checkbox-blank-circle-line";

  return (
    <Alert className={cn("border", toneClasses[tone], className)}>
      <i className={cn("text-base", iconClass, statusIconClasses[tone])} />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription className="whitespace-normal break-words leading-6 text-pretty">
        {children}
      </AlertDescription>
    </Alert>
  );
}

export function LegalTextPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-muted/45 p-3 font-mono text-xs leading-6 text-foreground/80",
        className
      )}
    >
      {children}
    </div>
  );
}
