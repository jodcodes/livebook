"use client";

import { useState, useRef, useEffect } from "react";
import { decodeSharePayload } from "@/lib/shareEncoding";
import { useAuth } from "../app/context/AuthContext";
import { useLocale } from "@/app/context/LocaleContext";
import PlaybookUploadModal from "./PlaybookUploadModal";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, PremiumEmpty, StatusBadge, Notice } from "@/components/premium";
import { localActor } from "@/lib/actorDefaults";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  clause_ref?: string;
  position_used?: string;
  escalation_required?: boolean;
  next_action?: string;
  query_id?: string;
}

interface QuestionAnswer {
  answer: string;
  clause_ref: string;
  position_used: string;
  escalation_required: boolean;
  next_action: string;
  query_id?: string;
}

interface EscalationFormState {
  lawyerName: string;
  lawyerEmail: string;
  reason: string;
}

export default function ChatbotDashboard() {
  const { openPlaybookClause, userRole } = useAuth();
  const { t, formatTime } = useLocale();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [activeEscalationId, setActiveEscalationId] = useState<string | null>(null);
  const legalCounsel = localActor("lawyer");
  const [escalationForm, setEscalationForm] = useState<EscalationFormState>({
    lawyerName: legalCounsel.display_name,
    lawyerEmail: legalCounsel.email,
    reason: "",
  });
  const [escalationStatus, setEscalationStatus] = useState<Record<string, string>>({});
  const [escalationSubmitting, setEscalationSubmitting] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(`chat-${Date.now()}`);

  const currentActor = localActor(userRole === "lawyer" ? "lawyer" : "business");

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const shared = params.get("answer");
      if (!shared) return;
      try {
        const parsed = decodeSharePayload<QuestionAnswer>(shared);
        setMessages([
          {
            id: "shared",
            role: "assistant",
            content: parsed.answer,
            timestamp: t("Shared"),
            clause_ref: parsed.clause_ref,
            position_used: parsed.position_used,
            escalation_required: parsed.escalation_required,
            next_action: parsed.next_action,
          },
        ]);
      } catch {
        // Ignore malformed shared links.
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: formatTime(new Date()),
    };

    const priorMessages = messages;
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/backend/question", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          q: userMessage.content,
          session_id: sessionIdRef.current,
          created_by: currentActor,
          history: priorMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const answer = (await response.json()) as QuestionAnswer;
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: answer.answer,
        timestamp: formatTime(new Date()),
        clause_ref: answer.clause_ref,
        position_used: answer.position_used,
        escalation_required: answer.escalation_required,
        next_action: answer.next_action,
        query_id: answer.query_id,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: err instanceof Error ? err.message : String(err),
        timestamp: formatTime(new Date()),
        escalation_required: true,
        next_action: t("Review escalation before responding."),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setLoading(false);
    }
  };

  const formatAnswer = (message: Message) =>
    [
      message.content,
      message.clause_ref ? `${t("Clause")}: ${message.clause_ref}` : null,
      `${t("Escalation")}: ${message.escalation_required ? t("Escalation required") : t("Not required")}`,
      message.next_action ? `${t("Next action")}: ${message.next_action}` : null,
    ]
      .filter(Boolean)
      .join("\n");

  const copyAnswer = async (message: Message) => {
    const text = formatAnswer(message);
    const fallbackCopy = () => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopy();
      }
    } catch {
      fallbackCopy();
    }
    setCopiedMessageId(message.id);
    window.setTimeout(() => {
      setCopiedMessageId((current) => (current === message.id ? null : current));
    }, 1600);
  };

  const questionFor = (message: Message) => {
    const answerIndex = messages.findIndex((item) => item.id === message.id);
    if (answerIndex <= 0) return "";
    for (let index = answerIndex - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user") return messages[index].content;
    }
    return "";
  };

  const submitEscalation = async (message: Message) => {
    setEscalationSubmitting(true);
    setEscalationStatus((prev) => ({ ...prev, [message.id]: t("Creating review item...") }));
    try {
      const response = await fetch("/api/backend/escalations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query_id: message.query_id,
          created_by: currentActor,
          created_from: {
            source: "chat",
            session_id: sessionIdRef.current,
            message_id: message.id,
          },
          lawyer: {
            user_id: escalationForm.lawyerEmail || "local-lawyer",
            display_name: escalationForm.lawyerName,
            email: escalationForm.lawyerEmail,
          },
          question: questionFor(message) || t("Shared chat answer"),
          answer: message.content,
          clause_ref: message.clause_ref ?? t("Unknown clause"),
          position_used: message.position_used ?? "preferred",
          escalation_reason: escalationForm.reason,
          next_action: message.next_action ?? t("Review escalation before responding."),
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const result = (await response.json()) as {
        notification_result?: { status?: string; message?: string };
      };
      const notification = result.notification_result?.status ?? "queued";
      const note =
        notification === "failed"
          ? t("Queued for review; notification failed.")
          : t("Queued for review; notification queued.");
      setEscalationStatus((prev) => ({ ...prev, [message.id]: note }));
      setActiveEscalationId(null);
      setEscalationForm((prev) => ({ ...prev, reason: "" }));
    } catch (err) {
      setEscalationStatus((prev) => ({
        ...prev,
        [message.id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setEscalationSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <PageHeader
        eyebrow={t("Business guidance")}
        title={t("Livebook Chat")}
        description={t("Ask about contract rules, clauses, escalation triggers, and approved playbook positions.")}
        actions={<StatusBadge tone="success">{t("AI Online")}</StatusBadge>}
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
        {messages.length === 0 && (
          <PremiumEmpty
            icon={<i className="ri-sparkling-line text-base" />}
            title={t("Ask Livebook about contract rules")}
            description={t("Find playbook rules, contract language, fallback options, and escalation triggers without reading the source document.")}
            className="h-[calc(100vh-18rem)]"
          />
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn("flex gap-4", message.role === "user" ? "justify-end" : "justify-start")}
          >
            {message.role === "assistant" && (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <i className="ri-sparkling-line text-base" />
              </div>
            )}
            <div
              className={cn(
                "max-w-3xl rounded-2xl px-5 py-4 text-sm leading-relaxed shadow-sm",
                message.role === "user"
                  ? "rounded-br-md bg-primary text-primary-foreground"
                  : "rounded-bl-md border bg-card text-card-foreground"
              )}
            >
              {message.role === "assistant" && message.escalation_required && (
                <Notice tone="danger" title={t("Escalation required")} className="mb-3">
                  {t("Senior legal review is required before this position is accepted.")}
                </Notice>
              )}
              <div className="whitespace-pre-wrap">
                {message.content.split("**").map((part, i) =>
                  i % 2 === 1 ? (
                    <strong key={i} className="font-semibold">
                      {part}
                    </strong>
                  ) : (
                    part
                  )
                )}
              </div>
              {message.role === "assistant" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {message.clause_ref && (
                    <StatusBadge tone="neutral">{message.clause_ref}</StatusBadge>
                  )}
                  {message.next_action && (
                    <Notice tone="accent" className="w-full">{message.next_action}</Notice>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyAnswer(message)}
                  >
                    {copiedMessageId === message.id ? (
                      <i className="ri-check-line text-base" data-icon="inline-start" />
                    ) : (
                      <i className="ri-file-copy-line text-base" data-icon="inline-start" />
                    )}
                    {copiedMessageId === message.id ? t("Copied") : t("Copy")}
                  </Button>
                  {message.clause_ref && message.position_used !== "clarification" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openPlaybookClause(message.clause_ref ?? "")}
                    >
                      <i className="ri-book-open-line text-base" data-icon="inline-start" />
                      {t("Open clause")}
                    </Button>
                  )}
                  {message.escalation_required && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        setActiveEscalationId((current) =>
                          current === message.id ? null : message.id
                        )
                      }
                    >
                      <i className="ri-arrow-right-up-line text-base" data-icon="inline-start" />
                      {t("Escalate")}
                    </Button>
                  )}
                </div>
              )}
              {message.role === "assistant" &&
                message.escalation_required &&
                activeEscalationId === message.id && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitEscalation(message);
                    }}
                    className="mt-3 rounded-lg border border-red-200 bg-red-50/70 p-3"
                  >
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="text-xs font-semibold text-red-900">
                        {t("Lawyer")}
                        <Input
                          value={escalationForm.lawyerName}
                          onChange={(event) =>
                            setEscalationForm((prev) => ({
                              ...prev,
                              lawyerName: event.target.value,
                            }))
                          }
                          className="mt-1 bg-card"
                        />
                      </label>
                      <label className="text-xs font-semibold text-red-900">
                        {t("Email")}
                        <Input
                          type="email"
                          value={escalationForm.lawyerEmail}
                          onChange={(event) =>
                            setEscalationForm((prev) => ({
                              ...prev,
                              lawyerEmail: event.target.value,
                            }))
                          }
                          className="mt-1 bg-card"
                        />
                      </label>
                    </div>
                    <label className="mt-2 block text-xs font-semibold text-red-900">
                      {t("Reason")}
                      <Textarea
                        value={escalationForm.reason}
                        onChange={(event) =>
                          setEscalationForm((prev) => ({
                            ...prev,
                            reason: event.target.value,
                          }))
                        }
                        className="mt-1 h-20 bg-card"
                        placeholder={t("Counterparty asks for a red-line position")}
                      />
                    </label>
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        type="submit"
                        variant="destructive"
                        size="sm"
                        disabled={escalationSubmitting}
                      >
                        <i className="ri-alarm-warning-line text-base" data-icon="inline-start" />
                        {t("Notify lawyer")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setActiveEscalationId(null)}
                      >
                        {t("Cancel")}
                      </Button>
                    </div>
                  </form>
                )}
              {message.role === "assistant" && escalationStatus[message.id] && (
                <p className="mt-3 rounded-lg border bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
                  {escalationStatus[message.id]}
                </p>
              )}
              <div
                className={cn("mt-2 text-xs",
                  message.role === "user"
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground"
                )}
              >
                {message.timestamp}
              </div>
            </div>
            {message.role === "user" && (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
                <i className="ri-user-line text-base" />
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t bg-card/92 p-4 backdrop-blur">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-4xl items-end gap-3"
        >
          <InputGroup className="h-12 flex-1 bg-background">
            <InputGroupInput
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("Ask about liability limits, indemnification, termination clauses...")}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                onClick={() => setShowUpload(true)}
                aria-label={t("Upload playbook")}
                title={t("Upload playbook")}
                size="icon-sm"
              >
                <i className="ri-attachment-line text-base" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <Button
            type="submit"
            disabled={!input.trim() || loading}
            size="icon-lg"
            className="shrink-0"
            aria-label={t("Send message")}
          >
            {loading ? <i className="ri-loader-4-line animate-spin text-base" /> : <i className="ri-send-plane-line text-base" />}
          </Button>
        </form>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {t("Livebook may produce inaccurate information. Always verify critical legal decisions with Legal Counsel.")}
        </p>
      </div>
      {showUpload && (
        <PlaybookUploadModal
          uploaderRole={userRole === "business" ? "business" : "lawyer"}
          onUploadComplete={() => setShowUpload(false)}
          onClose={() => setShowUpload(false)}
        />
      )}
    </div>
  );
}
