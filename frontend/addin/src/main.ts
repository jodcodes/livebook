import {
  applyReviewInsights,
  askLivebook,
  createEscalation,
  listReviewSessions,
  loadPlaybookClause,
  reviewContractText,
} from "./api";
import {
  initializeOffice,
  insertTextAfterSelection,
  readDocumentText,
  readSelectedText,
  selectTextInDocument,
} from "./office";
import type {
  ChatTurn,
  PlaybookClause,
  QuestionResponse,
  TabularReviewRow,
  TabularReviewSession,
} from "./types";

type Tab = "review" | "ask" | "evolve";
type Status = "idle" | "loading" | "success" | "error";
type ContractSource = "selection" | "document";

interface State {
  ready: boolean;
  wordAvailable: boolean;
  activeTab: Tab;
  selectedText: string;
  contractText: string;
  contractSource: ContractSource;
  question: string;
  answer: QuestionResponse | null;
  askStatus: Status;
  chatHistory: ChatTurn[];
  escalationReason: string;
  escalationStatus: Status;
  escalationNotice: string;
  reviewSessions: TabularReviewSession[];
  reviewSession: TabularReviewSession | null;
  reviewStatus: Status;
  selectedRowId: string | null;
  selectedReviewClause: PlaybookClause | null;
  reviewSearch: string;
  outcomeFilter: string;
  confidenceFilter: string;
  applyStatus: Status;
  notice: string;
  error: string;
}

const root = document.getElementById("root");

const state: State = {
  ready: false,
  wordAvailable: false,
  activeTab: "evolve",
  selectedText: "",
  contractText: "",
  contractSource: "document",
  question: "",
  answer: null,
  askStatus: "idle",
  chatHistory: [],
  escalationReason: "",
  escalationStatus: "idle",
  escalationNotice: "",
  reviewSessions: [],
  reviewSession: null,
  reviewStatus: "idle",
  selectedRowId: null,
  selectedReviewClause: null,
  reviewSearch: "",
  outcomeFilter: "all",
  confidenceFilter: "all",
  applyStatus: "idle",
  notice: "",
  error: "",
};

initializeOffice()
  .then((available) => {
    state.ready = true;
    state.wordAvailable = available;
    render();
    void handleRefreshSessions(true);
  })
  .catch((error: Error) => {
    state.ready = true;
    state.wordAvailable = false;
    state.error = error.message;
    render();
  });

render();

function render() {
  if (!root) return;
  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <div class="brand-mark" aria-hidden="true">${icon("file")}</div>
        <div>
          <p class="eyebrow">Livebook</p>
          <h1>Word add-in</h1>
        </div>
      </header>
      <nav class="tabs" aria-label="Livebook modes">
        ${tabButton("review", "Review", "check")}
        ${tabButton("ask", "Ask", "message")}
        ${tabButton("evolve", "Evolve", "branch")}
      </nav>
      ${
        state.ready && !state.wordAvailable
          ? `<div class="alert subtle" role="status">${icon("document")}<span>Document actions are available when this pane is opened from Microsoft Word.</span></div>`
          : ""
      }
      ${state.error ? `<div class="alert" role="alert">${icon("alert")}<span>${escapeHtml(state.error)}</span></div>` : ""}
      ${state.notice ? `<div class="success-box top-notice">${icon("success")}<span>${escapeHtml(state.notice)}</span></div>` : ""}
      <main>${panelHtml()}</main>
    </div>
  `;
  bindEvents();
}

function tabButton(tab: Tab, label: string, iconName: string) {
  return `
    <button type="button" data-tab="${tab}" class="${state.activeTab === tab ? "active" : ""}">
      ${icon(iconName)}
      ${label}
    </button>
  `;
}

function panelHtml() {
  if (state.activeTab === "review") return reviewPanel();
  if (state.activeTab === "ask") return askPanel();
  return evolvePanel();
}

function reviewPanel() {
  const rows = filteredReviewRows();
  const selectedRow = currentRow();
  const session = state.reviewSession;
  return `
    <section class="panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Tabular Review</p>
          <h2>Compare Word content</h2>
        </div>
        <div class="toolbar">
          <button class="icon-button" type="button" data-action="refresh-sessions" title="Refresh sessions">
            ${icon("refresh")}
          </button>
          <button class="icon-button" type="button" data-action="read-selection" title="Read selected text">
            ${icon("clipboard")}
          </button>
          <button class="icon-button" type="button" data-action="read-document" title="Read whole document">
            ${icon("document")}
          </button>
        </div>
      </div>

      <div class="review-source">
        <div class="source-header">
          <span>${state.contractSource === "selection" ? "Selection" : "Document"}</span>
          <strong>${wordCount(state.contractText)} words</strong>
        </div>
        <p>${escapeHtml(previewText(state.contractText || "Read the Word document or selected text before running a review."))}</p>
      </div>

      <button class="primary-button" type="button" data-action="review-contract" ${state.reviewStatus === "loading" ? "disabled" : ""}>
        ${state.reviewStatus === "loading" ? icon("loader", "spin") : icon("scan")}
        ${state.reviewStatus === "loading" ? "Running review" : session ? "Run review again" : "Run review"}
      </button>

      ${session ? metricsHtml(session) : ""}
      ${state.reviewSessions.length > 0 ? sessionSelectHtml() : ""}

      ${
        session
          ? `
            <div class="filter-grid">
              <input class="search-input" id="reviewSearch" value="${escapeAttr(state.reviewSearch)}" placeholder="Search contract, counterparty, clause, evidence..." />
              <select id="outcomeFilter" class="select-input">
                ${option("all", "All outcomes", state.outcomeFilter)}
                ${option("preferred", "Preferred", state.outcomeFilter)}
                ${option("fallback_1", "Fallback 1", state.outcomeFilter)}
                ${option("fallback_2", "Fallback 2", state.outcomeFilter)}
                ${option("red_line_breached", "Red Line", state.outcomeFilter)}
              </select>
              <select id="confidenceFilter" class="select-input">
                ${option("all", "All confidence", state.confidenceFilter)}
                ${option("high", "High", state.confidenceFilter)}
                ${option("medium", "Medium", state.confidenceFilter)}
                ${option("low", "Low", state.confidenceFilter)}
              </select>
            </div>
            <div class="session-line">
              <span>${escapeHtml(session.contracts[0]?.counterparty ?? "Unknown counterparty")}</span>
              <span>${rows.length} rows</span>
            </div>
            <div class="review-list">${rows.map(reviewRowCard).join("")}</div>
            ${selectedRow ? reviewDetail(selectedRow) : ""}
          `
          : `<div class="empty-state">${icon("scan")}<span>No review session selected.</span></div>`
      }
    </section>
  `;
}

function sessionSelectHtml() {
  return `
    <select id="reviewSession" class="select-input">
      ${state.reviewSessions
        .map((session) => {
          const label = `${new Date(session.created_at).toLocaleString()} - ${session.metrics.contract_count} contracts, ${session.metrics.matched_clause_count} rows`;
          return option(session.session_id, label, state.reviewSession?.session_id ?? "");
        })
        .join("")}
    </select>
  `;
}

function askPanel() {
  return `
    <section class="panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Livebook Chat</p>
          <h2>Ask about the contract</h2>
        </div>
      </div>
      <form class="question-form" data-form="ask">
        <label for="question">Question</label>
        <textarea id="question" rows="4" placeholder="Ask about contract rules, clauses, or playbook positions...">${escapeHtml(state.question)}</textarea>
        <button class="primary-button" type="submit" ${state.askStatus === "loading" ? "disabled" : ""}>
          ${state.askStatus === "loading" ? icon("loader", "spin") : icon("send")}
          Ask Livebook
        </button>
      </form>
      ${state.answer ? answerCard(state.answer) : ""}
    </section>
  `;
}

function answerCard(answer: QuestionResponse) {
  const canInsertClause = Boolean(answer.suggestedClause?.trim());
  return `
    <article class="answer-card ${answer.escalationRequired ? "escalation" : ""}">
      ${
        answer.escalationRequired
          ? `<div class="escalation-banner">${icon("alert")}<span>Escalation required</span></div>`
          : ""
      }
      <div class="result-title">${icon("spark")}<span>Grounded answer</span></div>
      <p>${escapeHtml(answer.answer)}</p>
      <dl class="answer-meta">
        <div><dt>Clause</dt><dd>${escapeHtml(answer.clauseRef ?? "Not identified")}</dd></div>
        <div><dt>Position</dt><dd>${escapeHtml(formatLabel(answer.positionUsed ?? "unknown"))}</dd></div>
      </dl>
      ${answer.nextAction ? `<div class="next-action">${escapeHtml(answer.nextAction)}</div>` : ""}
      <div class="action-row">
        <button type="button" data-action="insert-answer">${icon("plus")}Insert answer</button>
        <button type="button" data-action="insert-clause" ${canInsertClause ? "" : "disabled"}>${icon("plus")}Insert clause</button>
      </div>
      ${
        answer.escalationRequired
          ? `
            <form class="question-form escalation-form" data-form="escalation">
              <label for="escalationReason">Reason</label>
              <textarea id="escalationReason" rows="3" placeholder="Why should Legal Counsel review this?">${escapeHtml(state.escalationReason)}</textarea>
              <button class="danger-button" type="submit" ${state.escalationStatus === "loading" ? "disabled" : ""}>
                ${state.escalationStatus === "loading" ? icon("loader", "spin") : icon("alert")}
                Escalate
              </button>
            </form>
          `
          : ""
      }
      ${state.escalationNotice ? `<div class="success-box">${icon("success")}<span>${escapeHtml(state.escalationNotice)}</span></div>` : ""}
      ${groundingHtml(answer.grounding)}
    </article>
  `;
}

function evolvePanel() {
  const row = currentRow();
  const session = state.reviewSession;
  const hasRows = Boolean(session?.rows.length);
  const hasEligibleRows = Boolean(session?.rows.some((item) => !item.applied && item.confidence !== "low"));
  const applyDisabled = state.applyStatus === "loading" || Boolean(session?.applied_at) || !hasEligibleRows;
  const applyLabel = session?.applied_at
    ? "Suggestions generated"
    : !hasRows
      ? "No review rows"
      : !hasEligibleRows
        ? "No eligible rows"
        : "Generate suggestions";
  return `
    <section class="panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Evolve</p>
          <h2>Generate suggestions</h2>
        </div>
        <button class="icon-button" type="button" data-action="refresh-sessions" title="Refresh sessions">
          ${icon("refresh")}
        </button>
      </div>

      ${
        session
          ? `
            ${metricsHtml(session)}
            ${state.reviewSessions.length > 0 ? sessionSelectHtml() : ""}
            <button class="primary-button" type="button" data-action="apply-insights" ${applyDisabled ? "disabled" : ""}>
              ${state.applyStatus === "loading" ? icon("loader", "spin") : icon("branch")}
              ${state.applyStatus === "loading" ? "Generating suggestions" : applyLabel}
            </button>
            ${
              row
                ? `<article class="detail-card">${detailBlock("Evidence", row.evidence)}${detailBlock("Rationale", row.rationale)}</article>`
                : `<div class="empty-state">${icon("scan")}<span>Refresh or select a review session with rows before generating suggestions.</span></div>`
            }
          `
          : `<div class="empty-state">${icon("scan")}<span>Run or select a review session first.</span></div>`
      }
    </section>
  `;
}

function metricsHtml(session: TabularReviewSession) {
  return `
    <dl class="metric-grid">
      ${metric("Contracts", session.metrics.contract_count)}
      ${metric("Rows", session.metrics.matched_clause_count)}
      ${metric("Avg Dev", session.metrics.average_deviation.toFixed(2))}
      ${metric("Fallbacks", session.metrics.fallback_rows)}
      ${metric("Red Lines", session.metrics.red_line_breaches, session.metrics.red_line_breaches > 0 ? "danger" : "")}
    </dl>
  `;
}

function metric(label: string, value: string | number, tone = "") {
  return `<div class="metric ${tone}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`;
}

function option(value: string, label: string, currentValue: string) {
  return `<option value="${escapeAttr(value)}" ${currentValue === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function reviewRowCard(row: TabularReviewRow) {
  const selected = currentRow()?.row_id === row.row_id;
  return `
    <button type="button" class="review-row ${selected ? "active" : ""}" data-row="${escapeAttr(row.row_id)}" title="Select row and jump to matching text in Word">
      <span class="outcome-pill ${toneForOutcome(row.outcome)}">${escapeHtml(formatLabel(row.outcome))}</span>
      <span class="review-row-title">${escapeHtml(row.clause_name)}</span>
      <span class="review-row-meta">${escapeHtml(row.file_name)} · ${escapeHtml(formatLabel(row.confidence))} · ${row.applied ? "Applied" : "Not applied"}</span>
    </button>
  `;
}

function reviewDetail(row: TabularReviewRow) {
  const clause =
    state.selectedReviewClause?.clause_id === row.clause_id ? state.selectedReviewClause : null;
  return `
    <article class="detail-card">
      <div class="detail-header">
        <div>
          <p class="eyebrow">${escapeHtml(row.clause_id)} · v${row.playbook_version}</p>
          <h3>${escapeHtml(row.clause_name)}</h3>
        </div>
        <span class="outcome-pill ${toneForOutcome(row.outcome)}">${escapeHtml(formatLabel(row.outcome))}</span>
      </div>
      ${detailBlock("Contract evidence", row.evidence || "No evidence")}
      ${detailBlock("Rationale", row.rationale || "No rationale")}
      <div class="detail-grid">
        <div><span>Counterparty</span><strong>${escapeHtml(row.counterparty)}</strong></div>
        <div><span>Confidence</span><strong>${escapeHtml(formatLabel(row.confidence))}</strong></div>
        <div><span>Deviation</span><strong>${row.deviation_score}/3</strong></div>
      </div>
      ${
        clause
          ? `<div class="playbook-context">
              <h3>Playbook Context</h3>
              ${detailBlock("Preferred", clause.positions?.preferred ?? "Not set")}
              ${detailBlock("Fallback 1", clause.positions?.fallback_1 ?? "Not set")}
              ${detailBlock("Fallback 2", clause.positions?.fallback_2 ?? "Not set")}
              ${detailBlock("Red line", clause.red_line ?? "Not set")}
              ${detailBlock("Escalation", clause.escalation_trigger ?? "Not set")}
            </div>`
          : ""
      }
    </article>
  `;
}

function detailBlock(title: string, body: string) {
  return `
    <div class="detail-block">
      <span>${escapeHtml(title)}</span>
      <p>${escapeHtml(body)}</p>
    </div>
  `;
}

function bindEvents() {
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab as Tab;
      state.error = "";
      state.notice = "";
      render();
      if ((state.activeTab === "review" || state.activeTab === "evolve") && state.reviewSessions.length === 0) {
        void handleRefreshSessions(true);
      }
    });
  });

  document.querySelector<HTMLFormElement>('[data-form="ask"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.question = valueOf("question");
    void handleAsk();
  });

  document.querySelector<HTMLFormElement>('[data-form="escalation"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.escalationReason = valueOf("escalationReason");
    void handleEscalation();
  });

  document.getElementById("reviewSearch")?.addEventListener("input", (event) => {
    state.reviewSearch = (event.target as HTMLInputElement).value;
    render();
    void loadClauseForRow(currentRow());
  });

  document.getElementById("outcomeFilter")?.addEventListener("change", (event) => {
    state.outcomeFilter = (event.target as HTMLSelectElement).value;
    render();
    void loadClauseForRow(currentRow());
  });

  document.getElementById("confidenceFilter")?.addEventListener("change", (event) => {
    state.confidenceFilter = (event.target as HTMLSelectElement).value;
    render();
    void loadClauseForRow(currentRow());
  });

  document.getElementById("reviewSession")?.addEventListener("change", (event) => {
    const sessionId = (event.target as HTMLSelectElement).value;
    const session = state.reviewSessions.find((item) => item.session_id === sessionId) ?? null;
    state.reviewSession = session;
    state.selectedRowId = session?.rows[0]?.row_id ?? null;
    state.selectedReviewClause = null;
    render();
    void loadClauseForRow(currentRow());
  });

  document.querySelectorAll<HTMLButtonElement>("[data-row]").forEach((button) => {
    button.addEventListener("click", () => {
      void handleReviewRowClick(button.dataset.row ?? null);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "read-selection") void handleReadSelection();
      if (action === "read-document") void handleReadDocument();
      if (action === "review-contract") void handleReviewContract();
      if (action === "refresh-sessions") void handleRefreshSessions();
      if (action === "apply-insights") void handleApplyInsights();
      if (action === "insert-answer") void handleInsert(state.answer?.answer);
      if (action === "insert-clause") void handleInsert(state.answer?.suggestedClause);
    });
  });
}

async function handleReviewRowClick(rowId: string | null) {
  if (!rowId) return;

  state.selectedRowId = rowId;
  state.selectedReviewClause = null;
  state.error = "";
  state.notice = "";
  const row = currentRow();
  render();
  void loadClauseForRow(row);

  if (!row || !state.wordAvailable) return;

  try {
    await selectTextInDocument([row.evidence, row.clause_name, row.clause_type]);
  } catch (error) {
    state.error = messageFromError(error);
    render();
  }
}

async function handleReadSelection() {
  state.error = "";
  state.notice = "";
  try {
    const text = await readSelectedText();
    state.selectedText = text;
    state.contractText = text;
    state.contractSource = "selection";
  } catch (error) {
    state.error = messageFromError(error);
  }
  render();
}

async function handleReadDocument() {
  state.error = "";
  state.notice = "";
  try {
    state.contractText = await readDocumentText();
    state.contractSource = "document";
  } catch (error) {
    state.error = messageFromError(error);
  }
  render();
}

async function handleReviewContract() {
  if (!state.contractText.trim()) {
    await handleReadDocument();
    if (!state.contractText.trim()) return;
  }
  state.reviewStatus = "loading";
  state.error = "";
  state.notice = "";
  render();
  try {
    state.reviewSession = await reviewContractText({
      contractText: state.contractText,
      fileName: state.contractSource === "selection" ? "Word selection" : "Word document",
    });
    state.selectedRowId = state.reviewSession.rows[0]?.row_id ?? null;
    state.reviewStatus = "success";
    state.notice =
      state.reviewSession.rows.length > 0
        ? `Review session created with ${state.reviewSession.rows.length} row${state.reviewSession.rows.length === 1 ? "" : "s"}.`
        : "Review completed, but no playbook clauses matched this Word content.";
    await handleRefreshSessions(true);
    await loadClauseForRow(currentRow());
  } catch (error) {
    state.reviewStatus = "error";
    state.error = messageFromError(error);
  }
  render();
}

async function handleAsk() {
  if (!state.question.trim()) return;
  state.askStatus = "loading";
  state.error = "";
  state.notice = "";
  state.escalationNotice = "";
  render();
  try {
    const answer = await askLivebook({
      question: state.question,
      audience: "business",
      history: state.chatHistory,
    });
    state.answer = answer;
    state.chatHistory = [
      ...state.chatHistory,
      { role: "user", content: state.question },
      { role: "assistant", content: answer.answer },
    ].slice(-10);
    state.askStatus = "success";
  } catch (error) {
    state.askStatus = "error";
    state.error = messageFromError(error);
  }
  render();
}

async function handleEscalation() {
  if (!state.answer) return;
  state.escalationStatus = "loading";
  state.error = "";
  state.escalationNotice = "";
  render();
  try {
    const response = await createEscalation({
      question: state.question || "Word add-in answer",
      answer: state.answer,
      reason: state.escalationReason,
    });
    const notification = response.notification_result?.status ?? "queued";
    state.escalationNotice = `Queued for review; notification ${notification}.`;
    state.escalationStatus = "success";
  } catch (error) {
    state.escalationStatus = "error";
    state.error = messageFromError(error);
  }
  render();
}

async function handleInsert(text: string | null | undefined) {
  if (!text?.trim()) return;
  state.error = "";
  state.notice = "";
  try {
    await insertTextAfterSelection(text.trim());
    state.notice = "Inserted into the Word document.";
  } catch (error) {
    state.error = messageFromError(error);
  }
  render();
}

async function handleRefreshSessions(silent = false) {
  if (!silent) {
    state.reviewStatus = "loading";
    state.error = "";
    state.notice = "";
    render();
  }
  try {
    const sessions = await listReviewSessions();
    state.reviewSessions = [...sessions].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const currentId = state.reviewSession?.session_id;
    const currentSession = state.reviewSessions.find((session) => session.session_id === currentId) ?? null;
    state.reviewSession =
      !silent || !currentSession?.rows.length
        ? preferredReviewSession(state.reviewSessions)
        : currentSession;
    state.selectedRowId =
      state.reviewSession?.rows.some((row) => row.row_id === state.selectedRowId)
        ? state.selectedRowId
        : state.reviewSession?.rows[0]?.row_id ?? null;
    state.reviewStatus = "success";
    await loadClauseForRow(currentRow());
  } catch (error) {
    state.reviewStatus = "error";
    if (!silent) state.error = messageFromError(error);
  }
  render();
}

async function handleApplyInsights() {
  if (!state.reviewSession) return;
  if (!state.reviewSession.rows.some((row) => !row.applied && row.confidence !== "low")) {
    state.applyStatus = "error";
    state.notice = "";
    state.error = state.reviewSession.rows.length
      ? "This review session has no eligible rows to generate suggestions from."
      : "This review session has no rows. Refresh or run the review again first.";
    render();
    return;
  }
  state.applyStatus = "loading";
  state.error = "";
  state.notice = "";
  render();
  try {
    state.reviewSession = await applyReviewInsights({
      sessionId: state.reviewSession.session_id,
      includeLowConfidence: false,
    });
    state.applyStatus = "success";
    state.notice = "Insights added to negotiation history. Evolve suggestions are ready for review.";
    await handleRefreshSessions(true);
  } catch (error) {
    state.applyStatus = "error";
    state.error = messageFromError(error);
  }
  render();
}

async function loadClauseForRow(row: TabularReviewRow | null) {
  if (!row) {
    state.selectedReviewClause = null;
    return;
  }
  try {
    state.selectedReviewClause = await loadPlaybookClause(row.clause_id);
  } catch {
    state.selectedReviewClause = null;
  }
  render();
}

function filteredReviewRows() {
  const rows = state.reviewSession?.rows ?? [];
  const query = state.reviewSearch.toLowerCase().trim();
  return rows.filter((row) => {
    const matchesOutcome = state.outcomeFilter === "all" || row.outcome === state.outcomeFilter;
    const matchesConfidence =
      state.confidenceFilter === "all" || row.confidence === state.confidenceFilter;
    const matchesSearch =
      !query ||
      [
        row.counterparty,
        row.file_name,
        row.clause_id,
        row.clause_name,
        row.clause_type,
        row.outcome,
        row.confidence,
        row.evidence,
        row.rationale,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    return matchesOutcome && matchesConfidence && matchesSearch;
  });
}

function currentRow() {
  const rows = filteredReviewRows();
  return (
    rows.find((row) => row.row_id === state.selectedRowId) ??
    state.reviewSession?.rows.find((row) => row.row_id === state.selectedRowId) ??
    rows[0] ??
    null
  );
}

function preferredReviewSession(sessions: TabularReviewSession[]) {
  return (
    sessions.find((session) => session.rows.some((row) => !row.applied && row.confidence !== "low")) ??
    sessions.find((session) => session.rows.length > 0) ??
    sessions[0] ??
    null
  );
}

function groundingHtml(items: string[]) {
  if (!items.length) return "";
  return `
    <details class="grounding">
      <summary>Show grounding</summary>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </details>
  `;
}

function toneForOutcome(outcome: TabularReviewRow["outcome"]) {
  if (outcome === "red_line_breached") return "red";
  if (outcome === "fallback_2") return "orange";
  if (outcome === "fallback_1") return "amber";
  return "green";
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function previewText(value: string, max = 520) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trim()}...`;
}

function wordCount(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function valueOf(id: string) {
  const element = document.getElementById(id) as HTMLTextAreaElement | HTMLInputElement | null;
  return element?.value ?? "";
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected Livebook error";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function icon(name: string, className = "") {
  const attrs = `class="${className}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const paths: Record<string, string> = {
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z"/>',
    branch: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    check: '<path d="M9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h6"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 15h6"/><path d="M9 11h2"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
    message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8"/><path d="M8 13h5"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.5 5.7L21 8"/><path d="M21 3v5h-5"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    spark: '<path d="M12 3 9.6 8.6 4 11l5.6 2.4L12 19l2.4-5.6L20 11l-5.6-2.4Z"/>',
    success: '<path d="M20 6 9 17l-5-5"/>',
  };
  return `<svg ${attrs}>${paths[name] ?? paths.file}</svg>`;
}
