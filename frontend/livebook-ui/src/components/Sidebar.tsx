"use client";

import { useState } from "react";

import { useAuth } from "../app/context/AuthContext";
import { useLocale } from "@/app/context/LocaleContext";
import { Button } from "@/components/ui/button";
import LanguageToggle from "@/components/LanguageToggle";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/premium";
import { cn } from "@/lib/utils";

const baseNavItems = [
  { iconClass: "ri-message-3-line", label: "Current Chat", view: "chat" as const },
  { iconClass: "ri-history-line", label: "Past Queries", view: "history" as const },
  { iconClass: "ri-book-open-line", label: "Playbook Rules", view: "playbook" as const },
  { iconClass: "ri-git-branch-line", label: "Version History", view: "versionHistory" as const },
  { iconClass: "ri-table-line", label: "Tabular Review", view: "tabularReview" as const },
];

export default function Sidebar() {
  const { signOut, userRole, currentView, setView } = useAuth();
  const { t } = useLocale();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const navItems =
    userRole === "lawyer"
      ? [...baseNavItems, { iconClass: "ri-flow-chart", label: "Review Queue", view: "review" as const }]
      : baseNavItems;
  const roleLabel = userRole === "business" ? t("Business User") : t("Legal Counsel");
  const roleIconClass = userRole === "business" ? "ri-briefcase-line" : "ri-scales-line";
  const toggleLabel = isCollapsed ? t("Expand sidebar") : t("Collapse sidebar");

  return (
    <aside
      className={cn(
        "legal-hairline flex h-screen shrink-0 flex-col border-r bg-sidebar/92 text-sidebar-foreground backdrop-blur transition-[width] duration-200 ease-out",
        isCollapsed ? "w-20" : "w-72",
        "max-sm:w-20"
      )}
    >
      <div className="border-b px-4 py-4">
        <div className={cn("flex items-center gap-3", isCollapsed ? "justify-center" : "justify-between")}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <i className="ri-book-open-line text-lg" />
            </div>
            <div className={cn("min-w-0 max-sm:sr-only", isCollapsed && "sr-only")}>
              <h1 className="truncate text-xl font-semibold tracking-tight">Livebook</h1>
              <p className="truncate text-xs text-muted-foreground">{t("Legal workspace")}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setIsCollapsed((current) => !current)}
            aria-label={toggleLabel}
            aria-expanded={!isCollapsed}
            title={toggleLabel}
            className={cn("max-sm:hidden", isCollapsed && "hidden")}
          >
            <i className="ri-arrow-left-s-line text-base" />
          </Button>
        </div>
        {isCollapsed ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setIsCollapsed(false)}
            aria-label={toggleLabel}
            aria-expanded={false}
            title={toggleLabel}
            className="mt-3 w-full"
          >
            <i className="ri-arrow-right-s-line text-base" />
          </Button>
        ) : null}
      </div>

      <nav className="flex-1 px-3 py-4">
        <div className="flex flex-col gap-1">
          {navItems.map((item) => {
            const active = currentView === item.view;
            const button = (
              <Button
                key={item.view}
                type="button"
                variant={active ? "secondary" : "ghost"}
                onClick={() => setView(item.view)}
                title={isCollapsed ? item.label : undefined}
                className={cn(
                  "h-10 justify-start border-transparent text-muted-foreground hover:text-foreground",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground shadow-none",
                  isCollapsed ? "w-full justify-center px-0" : "w-full px-3",
                  "max-sm:w-full max-sm:justify-center max-sm:px-0"
                )}
              >
                <i className={cn("text-base", item.iconClass)} data-icon="inline-start" />
                <span className={cn("truncate", isCollapsed && "sr-only", "max-sm:sr-only")}>
                  {t(item.label)}
                </span>
              </Button>
            );

            return isCollapsed ? (
              <Tooltip key={item.view}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : (
              button
            );
          })}
        </div>
      </nav>

      <div className="px-3 pb-16">
        <Separator className="mb-4" />
        <div className={cn("mb-3 flex items-center gap-3 rounded-lg border bg-card p-3", isCollapsed && "justify-center p-2", "max-sm:justify-center max-sm:p-2")}>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <i className={cn("text-base", roleIconClass)} />
          </div>
          <div className={cn("min-w-0 flex-1", isCollapsed && "sr-only", "max-sm:sr-only")}>
            <p className="truncate text-sm font-medium">{roleLabel}</p>
            <p className="truncate text-xs text-muted-foreground">{t("Demo workspace")}</p>
          </div>
          <StatusBadge tone="accent" className={cn(isCollapsed && "sr-only", "max-sm:sr-only")}>
            {t("Live")}
          </StatusBadge>
        </div>
        <div className={cn("flex gap-2", isCollapsed ? "flex-col" : "items-center")}>
          <Button
            type="button"
            variant="ghost"
            onClick={signOut}
            title={isCollapsed ? t("Sign Out") : undefined}
            className={cn(
              "h-10 justify-start text-muted-foreground hover:text-foreground",
              isCollapsed ? "w-full justify-center px-0" : "flex-1 px-3",
              "max-sm:w-full max-sm:justify-center max-sm:px-0"
            )}
          >
            <i className="ri-logout-box-line text-base" data-icon="inline-start" />
            <span className={cn("truncate", isCollapsed && "sr-only", "max-sm:sr-only")}>
              {t("Sign Out")}
            </span>
          </Button>
          <LanguageToggle className={cn(isCollapsed ? "justify-center" : "shrink-0")} compact />
        </div>
      </div>
    </aside>
  );
}
