"use client";

import { useMemo } from "react";
import { useLocale } from "@/app/context/LocaleContext";
import { decodeSharePayload } from "@/lib/shareEncoding";

interface SharedAnswer {
  answer: string;
  clause_ref: string;
  position_used: string;
  escalation_required: boolean;
  next_action: string;
}

function readSharedAnswer(): SharedAnswer | null {
  if (typeof window === "undefined") return null;
  const encoded = new URLSearchParams(window.location.search).get("answer");
  if (!encoded) return null;
  try {
    return decodeSharePayload<SharedAnswer>(encoded);
  } catch {
    return null;
  }
}

export default function SharePage() {
  const { t } = useLocale();
  const answer = useMemo(() => readSharedAnswer(), []);

  return (
    <main className="min-h-screen bg-muted/40 p-6 text-foreground">
      <section className="mx-auto max-w-3xl rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-livebook-pale text-livebook">
            <i className="ri-share-line text-xl" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t("Shared Livebook Answer")}</h1>
            <p className="text-sm text-muted-foreground">{t("Static answer snapshot, no re-query.")}</p>
          </div>
        </div>

        {!answer ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {t("Shared answer link is invalid or expired.")}
          </p>
        ) : (
          <div className="space-y-4">
            {answer.escalation_required && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                <i className="ri-alarm-warning-line mr-2" />
                {t("Escalation required")}
              </div>
            )}
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {answer.answer}
            </p>
            <div className="flex flex-wrap gap-2">
              {answer.clause_ref && (
                <span className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-semibold text-muted-foreground">
                  {answer.clause_ref}
                </span>
              )}
              {answer.position_used && (
                <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
                  {answer.position_used}
                </span>
              )}
            </div>
            {answer.next_action && (
              <p className="rounded-lg bg-livebook-pale p-3 text-sm font-semibold text-livebook-dark">
                {answer.next_action}
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
