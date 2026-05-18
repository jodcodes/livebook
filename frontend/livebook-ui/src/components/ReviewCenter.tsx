"use client";

import { useMemo, useState } from "react";

import { useLocale } from "@/app/context/LocaleContext";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusBadge } from "@/components/premium";
import { cn } from "@/lib/utils";
import ProductSuite from "./ProductSuite";
import TabularReview from "./TabularReview";

type UserRole = "business" | "lawyer";
type ReviewLane = "single" | "batch" | "proofread";

const lanes: Array<{
  id: ReviewLane;
  label: string;
  description: string;
  iconClass: string;
}> = [
  {
    id: "single",
    label: "Single Document",
    description: "Legal-risk review for the active matter text.",
    iconClass: "ri-file-search-line",
  },
  {
    id: "batch",
    label: "Batch Review",
    description: "Compare uploaded contracts against the current playbook.",
    iconClass: "ri-table-line",
  },
  {
    id: "proofread",
    label: "Proofread",
    description: "Final cleanup checks kept separate from legal-risk review.",
    iconClass: "ri-check-double-line",
  },
];

export default function ReviewCenter({ userRole }: { userRole: UserRole }) {
  const { t } = useLocale();
  const [activeLane, setActiveLane] = useState<ReviewLane>("single");

  const activeDescription = useMemo(
    () => lanes.find((lane) => lane.id === activeLane)?.description ?? lanes[0].description,
    [activeLane]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <PageHeader
        eyebrow={t("Review Center")}
        title={t("Review")}
        description={t("Run legal review, batch playbook comparison, and final proofread from one matter context.")}
        meta={
          <>
            <StatusBadge tone="accent">{t("Single Document")}</StatusBadge>
            <StatusBadge tone="info">{t("Batch Review")}</StatusBadge>
            <StatusBadge tone="neutral">{t("Proofread")}</StatusBadge>
          </>
        }
      />

      <div className="border-b bg-card px-5 py-3">
        <div className="flex flex-wrap gap-2">
          {lanes.map((lane) => {
            const isActive = lane.id === activeLane;
            return (
              <Button
                key={lane.id}
                type="button"
                variant={isActive ? "secondary" : "ghost"}
                onClick={() => setActiveLane(lane.id)}
                className={cn(
                  "h-auto justify-start gap-3 px-3 py-2 text-left",
                  isActive && "border border-border bg-background"
                )}
              >
                <i className={cn("text-base", lane.iconClass)} data-icon="inline-start" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{t(lane.label)}</span>
                  <span className="block max-w-72 truncate text-xs font-normal text-muted-foreground">
                    {t(lane.description)}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t(activeDescription)}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeLane === "single" ? <ProductSuite activeWorkflowId="word-review" /> : null}
        {activeLane === "batch" ? <TabularReview userRole={userRole} /> : null}
        {activeLane === "proofread" ? <ProductSuite activeWorkflowId="proofread" /> : null}
      </div>
    </div>
  );
}
