"use client";

import { useAuth } from "../app/context/AuthContext";
import { useLocale } from "@/app/context/LocaleContext";
import LanguageToggle from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/premium";

export default function SignInView() {
  const { signIn } = useAuth();
  const { t } = useLocale();

  return (
    <main className="premium-shell flex min-h-screen items-center justify-center px-6 py-10 text-foreground">
      <div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="flex flex-col justify-between rounded-lg border bg-card p-8 shadow-sm lg:min-h-[620px]">
          <div>
            <div className="mb-8 flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <i className="ri-book-open-line text-xl" />
              </div>
              <div>
                <p className="text-xl font-semibold tracking-tight">Livebook</p>
                <p className="text-sm text-muted-foreground">{t("Legal workspace")}</p>
              </div>
            </div>

            <StatusBadge tone="accent">{t("Living playbook engine")}</StatusBadge>
            <h1 className="mt-5 max-w-xl text-4xl font-semibold tracking-tight text-foreground lg:text-5xl">
              {t("Legal guidance that stays current, cited, and controlled.")}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
              {t(
                "Ask playbook questions in plain language, review clause intelligence, and keep negotiation knowledge under lawyer approval.",
              )}
            </p>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-muted/40 p-4">
              <i className="ri-sparkling-line mb-3 text-base text-livebook" />
              <p className="text-sm font-semibold">{t("Talk")}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("Plain answers with clause citations.")}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-4">
              <i className="ri-shield-check-line mb-3 text-base text-livebook" />
              <p className="text-sm font-semibold">{t("Control")}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("No playbook change without approval.")}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-4">
              <i className="ri-scales-line mb-3 text-base text-livebook" />
              <p className="text-sm font-semibold">{t("Evolve")}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("Patterns become reviewed suggestions.")}
              </p>
            </div>
          </div>
        </section>

        <Card className="w-full max-w-xl self-center border-border/80 shadow-sm">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-2xl">{t("Choose workspace")}</CardTitle>
                <CardDescription>{t("Select how you want to use Livebook.")}</CardDescription>
              </div>
              <LanguageToggle compact />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-auto min-w-0 justify-start gap-4 p-5 text-left"
              onClick={() => signIn("business")}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <i className="ri-briefcase-line text-xl" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-foreground">{t("Business User")}</span>
                <span className="mt-1 block text-sm font-normal text-muted-foreground">
                  {t("Ask the playbook and share sourced answers.")}
                </span>
              </span>
              <i className="ri-arrow-right-line text-base" data-icon="inline-end" />
            </Button>

            <Button
              type="button"
              variant="outline"
              className="h-auto min-w-0 justify-start gap-4 p-5 text-left"
              onClick={() => signIn("lawyer")}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <i className="ri-scales-line text-xl" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-foreground">{t("Legal Counsel")}</span>
                <span className="mt-1 block text-sm font-normal text-muted-foreground">
                  {t("Approve changes and maintain clause rules.")}
                </span>
              </span>
              <i className="ri-arrow-right-line text-base" data-icon="inline-end" />
            </Button>

            <Separator className="my-3" />
            <p className="text-center text-xs text-muted-foreground">
              {t("Explore the workspace and switch roles at any time.")}
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
