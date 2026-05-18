"use client";

import { useState } from "react";

import { useAuth } from "@/app/context/AuthContext";
import { PageHeader, Panel, StatusBadge } from "@/components/premium";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const STORAGE_KEY = "livebook.product.settings.v1";
const defaultSettings = {
  tone: "Plain English, concise, business-friendly.",
  style: "Prefer balanced language unless a party position is selected.",
  sourcePolicy:
    "User precedents are reusable drafting context only; approved playbook clauses remain the policy source.",
};

const roleMatrix = [
  {
    role: "Legal reviewer",
    permissions: "Approve playbooks, resolve Legal Queue items, apply document changes.",
    status: "active",
  },
  {
    role: "Business user",
    permissions: "Ask, draft, review read-only results, and escalate to Legal Queue.",
    status: "active",
  },
  {
    role: "Admin",
    permissions: "Manage teams, role defaults, shared libraries, and import/export settings.",
    status: "planned",
  },
  {
    role: "Viewer",
    permissions: "Read approved playbook guidance, history, and completed matter summaries.",
    status: "planned",
  },
];

function readSettings() {
  if (typeof window === "undefined") return defaultSettings;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultSettings;
  try {
    return {
      ...defaultSettings,
      ...(JSON.parse(raw) as Partial<typeof defaultSettings>),
    };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return defaultSettings;
  }
}

export default function WorkspaceSettings() {
  const { userRole } = useAuth();
  const [tone, setTone] = useState(() => readSettings().tone);
  const [style, setStyle] = useState(() => readSettings().style);
  const [sourcePolicy, setSourcePolicy] = useState(() => readSettings().sourcePolicy);
  const [notice, setNotice] = useState("");

  const saveSettings = () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tone,
        style,
        sourcePolicy,
      })
    );
    setNotice("Workspace settings saved locally.");
  };

  const canManageSharedSettings = userRole === "lawyer";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <PageHeader
        eyebrow="Product settings"
        title="Settings"
        description="Control role boundaries, drafting defaults, and source handling for the current workspace."
        meta={
          <>
            <StatusBadge tone="accent">Roles</StatusBadge>
            <StatusBadge tone="info">Tone</StatusBadge>
            <StatusBadge tone="neutral">Sources</StatusBadge>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Role permissions" description="Active roles are enforced in navigation and approval flows.">
          <div className="grid gap-3">
            {roleMatrix.map((item) => (
              <div key={item.role} className="rounded-lg border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{item.role}</p>
                  <StatusBadge tone={item.status === "active" ? "success" : "neutral"}>
                    {item.status}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{item.permissions}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Team drafting defaults"
          description={
            canManageSharedSettings
              ? "Saved defaults are applied to drafting and review context in this browser."
              : "Business users can inspect defaults; Legal Counsel manages shared settings."
          }
        >
          <div className="space-y-4">
            <label className="block space-y-2">
              <span className="text-xs font-medium text-muted-foreground">Tone</span>
              <Textarea
                value={tone}
                onChange={(event) => setTone(event.target.value)}
                disabled={!canManageSharedSettings}
                className="min-h-24 resize-none"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-xs font-medium text-muted-foreground">Drafting style</span>
              <Textarea
                value={style}
                onChange={(event) => setStyle(event.target.value)}
                disabled={!canManageSharedSettings}
                className="min-h-24 resize-none"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-xs font-medium text-muted-foreground">Source import/export policy</span>
              <Textarea
                value={sourcePolicy}
                onChange={(event) => setSourcePolicy(event.target.value)}
                disabled={!canManageSharedSettings}
                className="min-h-28 resize-none"
              />
            </label>
            <Button type="button" onClick={saveSettings} disabled={!canManageSharedSettings}>
              <i className="ri-save-line" data-icon="inline-start" />
              Save settings
            </Button>
            {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}
