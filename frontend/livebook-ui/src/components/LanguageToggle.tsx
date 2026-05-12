"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocale } from "@/app/context/LocaleContext";

export default function LanguageToggle({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { locale, setLocale, t } = useLocale();

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-border bg-card p-1",
        className,
      )}
      aria-label={t("Language")}
      title={t("Language")}
    >
      {(["de", "en"] as const).map((value) => {
        const active = locale === value;
        const label = value.toUpperCase();
        return (
          <Button
            key={value}
            type="button"
            variant={active ? "secondary" : "ghost"}
            size={compact ? "sm" : "sm"}
            onClick={() => setLocale(value)}
            aria-pressed={active}
            title={value === "de" ? t("German") : t("English")}
            className={cn(
              "min-w-10 rounded-md px-2.5 text-xs font-semibold tracking-wide",
              active && "shadow-none",
            )}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
