"use client";

import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { useAuth } from "./AuthContext";

export interface AssessmentData {
  applicable: string;
  description: string;
  reference: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  assessment?: AssessmentData;
  timestamp: string;
}

interface ChatContextType {
  messages: Message[];
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  sendMessage: (question: string) => Promise<void>;
  lastEscalationSuggestion: { question: string; aiResponse: string; relatedClauseId?: string } | null;
  clearEscalationSuggestion: () => void;
  handleEscalate: (question: string, aiResponse: string, relatedClauseId?: string) => string;
}

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content: `Hello! I'm Livebook, your legal playbook assistant. Ask me anything about contract rules, clauses, and playbook positions.`,
  timestamp: new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  }),
};

const ChatContext = createContext<ChatContextType | undefined>(undefined);

function needsEscalation(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("red line") ||
    lower.includes("escalate") ||
    lower.includes("escalation") ||
    lower.includes("legal counsel") ||
    lower.includes("must be escalated") ||
    lower.includes("i am unsure") ||
    lower.includes("i cannot") ||
    lower.includes("not specified in playbook") ||
    lower.includes("not enough information") ||
    lower.includes("does not contain") ||
    lower.includes("no clause") ||
    lower.includes("cannot determine") ||
    lower.includes("n/a")
  );
}

function extractClauseId(text: string): string | undefined {
  const clauseMatch = text.match(/(clause_[a-zA-Z0-9_]+)/i);
  if (clauseMatch) return clauseMatch[1];

  const ruleMatch = text.match(/(?:playbook\s+)?rule\s+(\d+\.?\d*)/i);
  if (ruleMatch) return `clause_${ruleMatch[1].replace(".", "_")}`;

  return undefined;
}

function parseAssessment(raw: string): { text: string; assessment?: AssessmentData } {
  try {
    const data = JSON.parse(raw);
    return {
      assessment: {
        applicable: data.applicable ?? "N/A",
        description: data.description ?? "",
        reference: data.reference ?? "",
      },
      text: "",
    };
  } catch {
    return { text: raw };
  }
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [lastEscalationSuggestion, setLastEscalationSuggestion] = useState<{ question: string; aiResponse: string; relatedClauseId?: string } | null>(null);
  const { addQuery, addEscalation, updateQueryStatus, linkQueryToEscalation } = useAuth();
  const lastQueryIdRef = useRef<string | null>(null);

  const clearEscalationSuggestion = useCallback(() => {
    setLastEscalationSuggestion(null);
  }, []);

  const handleEscalate = useCallback((question: string, aiResponse: string, relatedClauseId?: string) => {
    const escalationId = addEscalation({ question, aiResponse, status: "pending", relatedClauseId });
    // Link the query to this escalation
    if (lastQueryIdRef.current) {
      linkQueryToEscalation(lastQueryIdRef.current, escalationId);
      updateQueryStatus(lastQueryIdRef.current, "escalated");
    }
    clearEscalationSuggestion();
    return escalationId;
  }, [addEscalation, linkQueryToEscalation, updateQueryStatus, clearEscalationSuggestion]);

  const sendMessage = useCallback(
    async (question: string) => {
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: question,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setLastEscalationSuggestion(null);
      lastQueryIdRef.current = null;

      try {
        console.log("[FRONTEND] Sending question:", question);
        const response = await fetch(
          `/api/question?q=${encodeURIComponent(question)}`
        );
        const responseText = await response.text();
        console.log("[FRONTEND] Response status:", response.status);
        console.log("[FRONTEND] Response body:", responseText.substring(0, 2000));

        let answer: string;
        let assessment: AssessmentData | undefined;
        let status: "resolved" | "escalated";

        if (response.ok) {
          const parsed = parseAssessment(responseText);
          answer = parsed.text || "";
          assessment = parsed.assessment;

          // N/A assessment = playbook cannot answer → escalate
          const isNa = assessment?.applicable.toLowerCase() === "na";
          status = isNa ? "escalated" : "resolved";
        } else {
          answer = `Sorry, I encountered an error (${response.status}): ${responseText || "Unknown error"}`;
          status = "escalated";
        }

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: answer,
          assessment,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setMessages((prev) => [...prev, assistantMessage]);

        // Add query and track its ID
        const cleanAiResponse = answer || assessment?.description || "";
        const queryId = addQuery({ question, aiResponse: cleanAiResponse, status });
        lastQueryIdRef.current = queryId;

        // Auto-detect escalation need
        const textToCheck = answer || `${assessment?.applicable} ${assessment?.description}`;
        const isNaAssessment = assessment?.applicable.toLowerCase() === "na";
        if (isNaAssessment || needsEscalation(textToCheck)) {
          const relatedClauseId = extractClauseId(textToCheck);
          // Store only the clean description for the escalation ticket
          setLastEscalationSuggestion({ question, aiResponse: assessment?.description || textToCheck, relatedClauseId });
        }
      } catch (err) {
        const errorText =
          err instanceof Error
            ? err.message
            : "Network error. Is the backend running?";
        console.error("[FRONTEND] Fetch error:", errorText);
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Sorry, I couldn't reach the server: ${errorText}`,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        addQuery({
          question,
          aiResponse: errorText,
          status: "escalated",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [addQuery]
  );

  return (
    <ChatContext.Provider
      value={{ messages, input, setInput, isLoading, sendMessage, lastEscalationSuggestion, clearEscalationSuggestion, handleEscalate }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
