"use client";

import { useState } from "react";

import { useLocale } from "@/app/context/LocaleContext";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/premium";
import { cn } from "@/lib/utils";
import ChatbotDashboard from "./ChatbotDashboard";
import ProductSuite from "./ProductSuite";

type AskMode = "playbook" | "document";

const askModes: Array<{
  id: AskMode;
  label: string;
  description: string;
  iconClass: string;
}> = [
  {
    id: "playbook",
    label: "Playbook Guidance",
    description: "Ask approved playbook questions with clause citations.",
    iconClass: "ri-book-open-line",
  },
  {
    id: "document",
    label: "Document Context",
    description: "Ask against selected text, active document text, and playbook guidance.",
    iconClass: "ri-file-text-line",
  },
];

export default function AskWorkspace() {
  const { t } = useLocale();
  const [mode, setMode] = useState<AskMode>("playbook");

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="border-b bg-card px-5 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-livebook-dark">
              {t("Unified Ask")}
            </p>
            <h1 className="text-lg font-semibold tracking-tight">{t("Ask")}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="accent">{t("Playbook")}</StatusBadge>
            <StatusBadge tone="info">{t("Document")}</StatusBadge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {askModes.map((item) => {
            const isActive = item.id === mode;
            return (
              <Button
                key={item.id}
                type="button"
                variant={isActive ? "secondary" : "ghost"}
                onClick={() => setMode(item.id)}
                className={cn("h-auto justify-start gap-3 px-3 py-2 text-left", isActive && "border bg-background")}
              >
                <i className={cn("text-base", item.iconClass)} data-icon="inline-start" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{t(item.label)}</span>
                  <span className="block max-w-80 truncate text-xs font-normal text-muted-foreground">
                    {t(item.description)}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "playbook" ? <ChatbotDashboard /> : <ProductSuite activeWorkflowId="document-chat" />}
      </div>
    </div>
  );
}
