"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

type UserRole = "business" | "lawyer" | null;
type View =
  | "ask"
  | "history"
  | "playbook"
  | "versionHistory"
  | "reviewCenter"
  | "draft"
  | "projects"
  | "legalQueue"
  | "settings";

export interface PastQuery {
  id: string;
  date: string;
  question: string;
  aiResponse: string;
  status: "resolved" | "escalated" | "approved" | "rejected";
  escalationId?: string;
}

export interface EscalationTicket {
  id: string;
  date: string;
  question: string;
  aiResponse: string;
  status: "pending" | "approved" | "rejected";
  relatedClauseId?: string;
}

interface AuthContextType {
  userRole: UserRole;
  currentView: View;
  selectedPlaybookClauseRef: string | null;
  signIn: (role: Exclude<UserRole, null>) => void;
  signOut: () => void;
  setView: (view: View) => void;
  queries: PastQuery[];
  addQuery: (query: Omit<PastQuery, "id" | "date">) => string;
  updateQueryStatus: (queryId: string, status: PastQuery["status"]) => void;
  linkQueryToEscalation: (queryId: string, escalationId: string) => void;
  escalations: EscalationTicket[];
  addEscalation: (ticket: Omit<EscalationTicket, "id" | "date">) => string;
  approveEscalation: (id: string) => void;
  rejectEscalation: (id: string) => void;
  linkEscalationToClause: (id: string, clauseId: string) => void;
  openPlaybookClause: (clauseRef: string) => void;
  clearPlaybookClauseSelection: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const STORAGE_KEY = "livebook.auth.workspace.v1";
const emptyWorkspaceState = {
  queries: [] as PastQuery[],
  escalations: [] as EscalationTicket[],
};

function readWorkspaceState() {
  if (typeof window === "undefined") return emptyWorkspaceState;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyWorkspaceState;
  try {
    const saved = JSON.parse(raw) as {
      queries?: PastQuery[];
      escalations?: EscalationTicket[];
    };
    return {
      queries: Array.isArray(saved.queries) ? saved.queries : [],
      escalations: Array.isArray(saved.escalations) ? saved.escalations : [],
    };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return emptyWorkspaceState;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userRole, setUserRole] = useState<UserRole>(null);
  const [currentView, setCurrentView] = useState<View>("ask");
  const [queries, setQueries] = useState<PastQuery[]>(() => readWorkspaceState().queries);
  const [escalations, setEscalations] = useState<EscalationTicket[]>(
    () => readWorkspaceState().escalations
  );
  const [selectedPlaybookClauseRef, setSelectedPlaybookClauseRef] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        queries,
        escalations,
      })
    );
  }, [escalations, queries]);

  const signIn = useCallback((role: Exclude<UserRole, null>) => {
    setUserRole(role);
    setCurrentView("ask");
  }, []);

  const signOut = useCallback(() => {
    setUserRole(null);
    setCurrentView("ask");
    setSelectedPlaybookClauseRef(null);
  }, []);

  const setView = useCallback((view: View) => {
    setCurrentView(view);
  }, []);

  const addQuery = useCallback((query: Omit<PastQuery, "id" | "date">) => {
    const newQuery: PastQuery = {
      ...query,
      id: `Q-${Date.now()}`,
      date: new Date().toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    setQueries((prev) => [newQuery, ...prev]);
    return newQuery.id;
  }, []);

  const updateQueryStatus = useCallback((queryId: string, status: PastQuery["status"]) => {
    setQueries((prev) =>
      prev.map((query) => (query.id === queryId ? { ...query, status } : query))
    );
  }, []);

  const linkQueryToEscalation = useCallback((queryId: string, escalationId: string) => {
    setQueries((prev) =>
      prev.map((query) => (query.id === queryId ? { ...query, escalationId } : query))
    );
  }, []);

  const addEscalation = useCallback((ticket: Omit<EscalationTicket, "id" | "date">) => {
    const newTicket: EscalationTicket = {
      ...ticket,
      id: `LB-${Date.now()}`,
      date: new Date().toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    setEscalations((prev) => [newTicket, ...prev]);
    return newTicket.id;
  }, []);

  const linkEscalationToClause = useCallback((id: string, clauseId: string) => {
    setEscalations((prev) =>
      prev.map((ticket) => (ticket.id === id ? { ...ticket, relatedClauseId: clauseId } : ticket))
    );
  }, []);

  const approveEscalation = useCallback((id: string) => {
    setEscalations((prev) =>
      prev.map((ticket) => (ticket.id === id ? { ...ticket, status: "approved" as const } : ticket))
    );
    setQueries((prev) =>
      prev.map((query) =>
        query.escalationId === id ? { ...query, status: "approved" as const } : query
      )
    );
  }, []);

  const rejectEscalation = useCallback((id: string) => {
    setEscalations((prev) =>
      prev.map((ticket) => (ticket.id === id ? { ...ticket, status: "rejected" as const } : ticket))
    );
    setQueries((prev) =>
      prev.map((query) =>
        query.escalationId === id ? { ...query, status: "rejected" as const } : query
      )
    );
  }, []);

  const openPlaybookClause = useCallback((clauseRef: string) => {
    setSelectedPlaybookClauseRef(clauseRef);
    setCurrentView("playbook");
  }, []);

  const clearPlaybookClauseSelection = useCallback(() => {
    setSelectedPlaybookClauseRef(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        userRole,
        currentView,
        selectedPlaybookClauseRef,
        signIn,
        signOut,
        setView,
        queries,
        addQuery,
        updateQueryStatus,
        linkQueryToEscalation,
        escalations,
        addEscalation,
        approveEscalation,
        rejectEscalation,
        linkEscalationToClause,
        openPlaybookClause,
        clearPlaybookClauseSelection,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
