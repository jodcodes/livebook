"use client";

import { useState } from "react";

type GeneratedRule = Record<string, unknown>;

interface AIGeneratePromptModalProps {
  open: boolean;
  onClose: () => void;
  onGenerated: (rule: GeneratedRule) => void;
  defaultPrompt?: string;
  clauseId: string;
  currentRule?: GeneratedRule;
}

export default function AIGeneratePromptModal({
  open,
  onClose,
  onGenerated,
  defaultPrompt = "",
  clauseId,
  currentRule,
}: AIGeneratePromptModalProps) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/playbook/generate-rule-custom", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          clause_id: clauseId,
          current_rule: currentRule || undefined,
        }),
      });

      const data = (await res.json()) as GeneratedRule & { error?: string };

      if (!res.ok) {
        setError(data.error || `Failed to generate rule (${res.status})`);
        return;
      }

      onGenerated(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose}></div>

      {/* Modal */}
      <div className="relative bg-card rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">
            <i className="ri-sparkling-line text-livebook mr-2"></i>
            Generate Rule with AI
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground/70 hover:text-muted-foreground transition-colors"
          >
            <i className="ri-close-line text-lg"></i>
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1.5">
              Describe what you want the rule to cover
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the rule you want to generate."
              rows={5}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-muted/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-livebook/20 focus:border-livebook resize-none"
            />
            <p className="text-xs text-muted-foreground/70 mt-1">
              The AI will read the entire current playbook for style reference.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <i className="ri-error-warning-line mr-1.5"></i>
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || loading}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-livebook text-white text-sm font-medium hover:bg-livebook-dark transition-colors disabled:opacity-50"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <i className="ri-sparkling-line"></i>
            )}
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
