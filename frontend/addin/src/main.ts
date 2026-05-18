import {
  askLivebook,
  createEscalation,
  listReviewSessions,
  loadPlaybookClause,
  reviewContractText,
  reviewWordProduct,
} from "./api";
import {
  acceptTrackedChangesInSelection,
  applySuggestionToMatchedText,
  getReviewedTextForSelection,
  getWordCapabilities,
  initializeOffice,
  insertCommentOnSelection,
  insertTextAfterSelection,
  readDocumentText,
  readSelectedText,
  rejectTrackedChangesInSelection,
  replaceSelectionWithTrackedText,
  selectTextInDocument,
  setChangeTrackingMode,
} from "./office";
import type {
  ChatTurn,
  PlaybookClause,
  ProductReviewFinding,
  ProductReviewSession,
  QuestionResponse,
  TabularReviewRow,
  TabularReviewSession,
} from "./types";
import type { ChangeTrackingMode, ReviewedTextSnapshot, WordCapabilities } from "./office";

type Tab = "review" | "ask";
type Status = "idle" | "loading" | "success" | "error";
type ContractSource = "selection" | "document";
type Locale = "en" | "de";

interface ReviewSuggestion {
  recommendedText: string | null;
  recommendationLabel: string;
  canRedline: boolean;
  rationale: string;
  comment: string;
}

interface State {
  ready: boolean;
  wordAvailable: boolean;
  locale: Locale;
  activeTab: Tab;
  selectedText: string;
  contractText: string;
  contractSource: ContractSource;
  question: string;
  answer: QuestionResponse | null;
  askStatus: Status;
  documentActionStatus: Status;
  trackingStatus: Status;
  chatHistory: ChatTurn[];
  escalationReason: string;
  escalationStatus: Status;
  escalationNotice: string;
  reviewSessions: TabularReviewSession[];
  reviewSession: TabularReviewSession | null;
  reviewStatus: Status;
  selectedRowId: string | null;
  productReviewSession: ProductReviewSession | null;
  selectedReviewClause: PlaybookClause | null;
  reviewSearch: string;
  outcomeFilter: string;
  confidenceFilter: string;
  notice: string;
  error: string;
  capabilities: WordCapabilities;
  reviewedText: ReviewedTextSnapshot | null;
}

const root = document.getElementById("root");

const state: State = {
  ready: false,
  wordAvailable: false,
  locale: detectLocale(),
  activeTab: "review",
  selectedText: "",
  contractText: "",
  contractSource: "document",
  question: "",
  answer: null,
  askStatus: "idle",
  documentActionStatus: "idle",
  trackingStatus: "idle",
  chatHistory: [],
  escalationReason: "",
  escalationStatus: "idle",
  escalationNotice: "",
  reviewSessions: [],
  reviewSession: null,
  reviewStatus: "idle",
  selectedRowId: null,
  productReviewSession: null,
  selectedReviewClause: null,
  reviewSearch: "",
  outcomeFilter: "all",
  confidenceFilter: "all",
  notice: "",
  error: "",
  capabilities: {
    comments: false,
    changeTracking: false,
    reviewedText: false,
    trackedChanges: false,
    changeTrackingMode: null,
  },
  reviewedText: null,
};

void boot();
render();

async function boot() {
  try {
    const available = await initializeOffice();
    state.ready = true;
    state.wordAvailable = available;
    if (available) {
      await refreshWordContext(true);
      void handleRefreshSessions(true);
    }
  } catch (error) {
    state.ready = true;
    state.wordAvailable = false;
    state.error = messageFromError(error);
  }
  render();
}

function render() {
  if (!root) return;
  document.documentElement.lang = state.locale;
  const copy = ui();

  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header app-header-rich">
        <div class="brand-mark" aria-hidden="true">${icon("file")}</div>
        <div class="header-copy">
          <p class="eyebrow">${copy.brand}</p>
          <h1>${copy.title}</h1>
        </div>
        <div class="header-actions">
          <div class="header-pills">
            ${runtimePill()}
            ${trackingPill()}
          </div>
          <div class="locale-switch" aria-label="${copy.language}">
            <button type="button" data-locale="de" class="${state.locale === "de" ? "active" : ""}">DE</button>
            <button type="button" data-locale="en" class="${state.locale === "en" ? "active" : ""}">EN</button>
          </div>
        </div>
      </header>
      <nav class="tabs" aria-label="${copy.modes}">
        ${tabButton("review", copy.reviewTab, "check")}
        ${tabButton("ask", copy.askTab, "message")}
      </nav>
      ${
        state.ready && !state.wordAvailable
          ? `<div class="alert subtle" role="status">${icon("document")}<span>${copy.wordRequired}</span></div>`
          : ""
      }
      ${capabilityWarning()}
      ${state.error ? `<div class="alert" role="alert">${icon("alert")}<span>${escapeHtml(state.error)}</span></div>` : ""}
      ${state.notice ? `<div class="success-box top-notice">${icon("success")}<span>${escapeHtml(state.notice)}</span></div>` : ""}
      <main>
        ${state.wordAvailable ? wordToolsPanel() : ""}
        ${panelHtml()}
      </main>
    </div>
  `;
  bindEvents();
}

function runtimePill() {
  return `<span class="runtime-pill">${escapeHtml(state.wordAvailable ? ui().wordConnected : ui().browserOnly)}</span>`;
}

function trackingPill() {
  if (!state.wordAvailable || !state.capabilities.changeTracking) return "";
  return `<span class="runtime-pill">${escapeHtml(changeTrackingModeLabel(state.capabilities.changeTrackingMode))}</span>`;
}

function capabilityWarning() {
  const copy = ui();
  if (!state.wordAvailable) return "";
  const missing: string[] = [];
  if (!state.capabilities.comments) missing.push(copy.noCommentsSupport);
  if (!state.capabilities.changeTracking) missing.push(copy.noTrackingSupport);
  if (!missing.length) return "";
  return `<div class="alert subtle" role="status">${icon("alert")}<span>${escapeHtml(missing.join(" "))}</span></div>`;
}

function tabButton(tab: Tab, label: string, iconName: string) {
  return `
    <button type="button" data-tab="${tab}" class="${state.activeTab === tab ? "active" : ""}">
      ${icon(iconName)}
      ${escapeHtml(label)}
    </button>
  `;
}

function panelHtml() {
  return state.activeTab === "review" ? reviewPanel() : askPanel();
}

function wordToolsPanel() {
  const copy = ui();
  const trackingBusy = state.trackingStatus === "loading";
  return `
    <section class="panel word-tools-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">${copy.wordToolsEyebrow}</p>
          <h2>${copy.wordToolsHeading}</h2>
        </div>
        <button class="icon-button" type="button" data-action="refresh-word-state" title="${copy.refreshWordState}">
          ${icon("refresh")}
        </button>
      </div>

      <div class="capability-pills">
        <span class="capability-pill ${state.capabilities.comments ? "ready" : "missing"}">${escapeHtml(copy.commentsCapability(state.capabilities.comments))}</span>
        <span class="capability-pill ${state.capabilities.changeTracking ? "ready" : "missing"}">${escapeHtml(copy.trackingCapability(state.capabilities.changeTracking))}</span>
        <span class="capability-pill ${state.capabilities.trackedChanges ? "ready" : "missing"}">${escapeHtml(copy.acceptRejectCapability(state.capabilities.trackedChanges))}</span>
      </div>

      ${
        state.capabilities.changeTracking
          ? `
            <div class="mode-grid">
              <button type="button" data-action="set-tracking-mine" class="${state.capabilities.changeTrackingMode === "TrackMineOnly" ? "active" : ""}" ${trackingBusy ? "disabled" : ""}>
                ${escapeHtml(copy.trackMineOnly)}
              </button>
              <button type="button" data-action="set-tracking-all" class="${state.capabilities.changeTrackingMode === "TrackAll" ? "active" : ""}" ${trackingBusy ? "disabled" : ""}>
                ${escapeHtml(copy.trackAll)}
              </button>
              <button type="button" data-action="set-tracking-off" class="${state.capabilities.changeTrackingMode === "Off" ? "active" : ""}" ${trackingBusy ? "disabled" : ""}>
                ${escapeHtml(copy.trackOff)}
              </button>
            </div>
          `
          : ""
      }

      <div class="action-row action-row-wide">
        <button type="button" data-action="accept-selection-changes" ${trackingBusy || !state.capabilities.trackedChanges ? "disabled" : ""}>
          ${icon("success")}
          ${escapeHtml(copy.acceptSelectionChanges)}
        </button>
        <button type="button" data-action="reject-selection-changes" ${trackingBusy || !state.capabilities.trackedChanges ? "disabled" : ""}>
          ${icon("close")}
          ${escapeHtml(copy.rejectSelectionChanges)}
        </button>
      </div>

      ${reviewedTextCard()}
    </section>
  `;
}

function reviewedTextCard() {
  const copy = ui();
  const snapshot = state.reviewedText;
  if (!snapshot?.selectionText.trim()) {
    return `<div class="empty-state">${icon("clipboard")}<span>${copy.noSelectionSnapshot}</span></div>`;
  }

  return `
    <article class="detail-card">
      <div class="detail-header">
        <div>
          <p class="eyebrow">${copy.selectionEyebrow}</p>
          <h3>${copy.selectionHeading}</h3>
        </div>
      </div>
      ${detailBlock(copy.selectionCurrent, snapshot.current || snapshot.selectionText)}
      ${
        snapshot.original && normalizeComparable(snapshot.original) !== normalizeComparable(snapshot.current)
          ? detailBlock(copy.selectionOriginal, snapshot.original)
          : ""
      }
    </article>
  `;
}

function reviewPanel() {
  const copy = ui();
  const rows = filteredReviewRows();
  const selectedRow = currentRow();
  const session = state.reviewSession;
  const suggestion = selectedRow ? buildReviewSuggestion(selectedRow, state.selectedReviewClause) : null;
  const documentBusy = state.documentActionStatus === "loading";

  return `
    <section class="panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">${copy.reviewEyebrow}</p>
          <h2>${copy.reviewHeading}</h2>
        </div>
        <div class="toolbar">
          <button class="icon-button" type="button" data-action="refresh-sessions" title="${copy.refreshSessions}">
            ${icon("refresh")}
          </button>
          <button class="icon-button" type="button" data-action="read-selection" title="${copy.readSelection}">
            ${icon("clipboard")}
          </button>
          <button class="icon-button" type="button" data-action="read-document" title="${copy.readDocument}">
            ${icon("document")}
          </button>
        </div>
      </div>

      <div class="review-source">
        <div class="source-header">
          <span>${state.contractSource === "selection" ? copy.selectionLabel : copy.documentLabel}</span>
          <strong>${wordCount(state.contractText)} ${escapeHtml(copy.words)}</strong>
        </div>
        <p>${escapeHtml(previewText(state.contractText || copy.reviewReadPrompt))}</p>
      </div>

      <button class="primary-button" type="button" data-action="review-contract" ${state.reviewStatus === "loading" ? "disabled" : ""}>
        ${state.reviewStatus === "loading" ? icon("loader", "spin") : icon("scan")}
        ${escapeHtml(state.reviewStatus === "loading" ? copy.runningReview : session ? copy.runReviewAgain : copy.runReview)}
      </button>
      <button class="secondary-button" type="button" data-action="product-word-review" ${state.reviewStatus === "loading" ? "disabled" : ""}>
        ${state.reviewStatus === "loading" ? icon("loader", "spin") : icon("spark")}
        ${escapeHtml(copy.runProductReview)}
      </button>

      ${session ? metricsHtml(session) : ""}
      ${state.reviewSessions.length > 0 ? sessionSelectHtml() : ""}
      ${productReviewHtml(documentBusy)}

      ${
        session
          ? `
            <div class="filter-grid">
              <input class="search-input" id="reviewSearch" value="${escapeAttr(state.reviewSearch)}" placeholder="${escapeAttr(copy.searchPlaceholder)}" />
              <select id="outcomeFilter" class="select-input">
                ${option("all", copy.allOutcomes, state.outcomeFilter)}
                ${option("preferred", copy.outcomeLabel("preferred"), state.outcomeFilter)}
                ${option("fallback_1", copy.outcomeLabel("fallback_1"), state.outcomeFilter)}
                ${option("fallback_2", copy.outcomeLabel("fallback_2"), state.outcomeFilter)}
                ${option("red_line_breached", copy.outcomeLabel("red_line_breached"), state.outcomeFilter)}
              </select>
              <select id="confidenceFilter" class="select-input">
                ${option("all", copy.allConfidence, state.confidenceFilter)}
                ${option("high", copy.confidenceLabel("high"), state.confidenceFilter)}
                ${option("medium", copy.confidenceLabel("medium"), state.confidenceFilter)}
                ${option("low", copy.confidenceLabel("low"), state.confidenceFilter)}
              </select>
            </div>
            <div class="session-line">
              <span>${escapeHtml(session.contracts[0]?.counterparty ?? copy.unknownCounterparty)}</span>
              <span>${rows.length} ${escapeHtml(copy.rows)}</span>
            </div>
            <div class="review-list">${rows.map(reviewRowCard).join("")}</div>
            ${
              selectedRow
                ? reviewDetail(selectedRow, suggestion, documentBusy)
                : `<div class="empty-state">${icon("scan")}<span>${copy.noSelectedRow}</span></div>`
            }
          `
          : `<div class="empty-state">${icon("scan")}<span>${copy.noReviewSession}</span></div>`
      }
    </section>
  `;
}

function reviewDetail(row: TabularReviewRow, suggestion: ReviewSuggestion | null, documentBusy: boolean) {
  const copy = ui();
  const clause =
    state.selectedReviewClause?.clause_id === row.clause_id ? state.selectedReviewClause : null;

  return `
    <article class="detail-card">
      <div class="detail-header">
        <div>
          <p class="eyebrow">${escapeHtml(row.clause_id)} · v${row.playbook_version}</p>
          <h3>${escapeHtml(row.clause_name)}</h3>
        </div>
        <span class="outcome-pill ${toneForOutcome(row.outcome)}">${escapeHtml(copy.outcomeLabel(row.outcome))}</span>
      </div>

      <div class="action-row action-row-wide">
        <button type="button" data-action="find-review-match">${icon("target")}${escapeHtml(copy.findInWord)}</button>
        <button type="button" data-action="comment-review-row" ${documentBusy || !state.capabilities.comments ? "disabled" : ""}>
          ${icon("comment")}
          ${escapeHtml(copy.addComment)}
        </button>
      </div>
      <div class="action-row action-row-wide">
        <button type="button" data-action="redline-review-row" ${documentBusy || !suggestion?.canRedline ? "disabled" : ""}>
          ${icon("branch")}
          ${escapeHtml(copy.applyRedline)}
        </button>
        <button type="button" data-action="redline-comment-review-row" ${documentBusy || !suggestion?.canRedline || !state.capabilities.comments ? "disabled" : ""}>
          ${icon("spark")}
          ${escapeHtml(copy.applyRedlineComment)}
        </button>
      </div>

      ${detailBlock(copy.contractEvidence, row.evidence || copy.noEvidence)}
      ${detailBlock(copy.rationale, row.rationale || copy.noRationale)}

      ${
        suggestion
          ? `
            <div class="proposal-box">
              <span>${escapeHtml(copy.wordSuggestion)}</span>
              <p>${escapeHtml(suggestion.rationale)}</p>
            </div>
            ${
              suggestion.recommendedText
                ? detailBlock(copy.recommendedWording, suggestion.recommendedText)
                : detailBlock(copy.recommendedWording, copy.noSuggestedWording)
            }
            ${detailBlock(copy.commentPreview, suggestion.comment)}
          `
          : ""
      }

      <div class="detail-grid">
        <div><span>${copy.counterparty}</span><strong>${escapeHtml(row.counterparty)}</strong></div>
        <div><span>${copy.confidence}</span><strong>${escapeHtml(copy.confidenceLabel(row.confidence))}</strong></div>
        <div><span>${copy.deviation}</span><strong>${row.deviation_score}/3</strong></div>
      </div>

      ${
        clause
          ? `<div class="playbook-context">
              <h3>${copy.playbookContext}</h3>
              ${detailBlock(copy.preferred, clause.positions?.preferred ?? copy.notSet)}
              ${detailBlock(copy.fallback1, clause.positions?.fallback_1 ?? copy.notSet)}
              ${detailBlock(copy.fallback2, clause.positions?.fallback_2 ?? copy.notSet)}
              ${detailBlock(copy.redLine, clause.red_line ?? copy.notSet)}
              ${detailBlock(copy.escalation, clause.escalation_trigger ?? copy.notSet)}
            </div>`
          : ""
      }
    </article>
  `;
}

function productReviewHtml(documentBusy: boolean) {
  const session = state.productReviewSession;
  const copy = ui();
  if (!session?.findings.length) return "";

  return `
    <section class="playbook-context">
      <h3>${escapeHtml(copy.productReviewHeading)}</h3>
      <div class="review-list">
        ${session.findings.map((finding) => productFindingCard(finding, documentBusy)).join("")}
      </div>
    </section>
  `;
}

function productFindingCard(finding: ProductReviewFinding, documentBusy: boolean) {
  const canRedline = Boolean(finding.redline?.trim());
  return `
    <article class="detail-card">
      <div class="detail-header">
        <div>
          <p class="eyebrow">${escapeHtml(finding.clause_ref)} · ${Math.round(finding.confidence * 100)}%</p>
          <h3>${escapeHtml(finding.issue)}</h3>
        </div>
        <span class="outcome-pill ${finding.severity === "high" ? "danger" : finding.severity === "medium" ? "warning" : ""}">
          ${escapeHtml(finding.severity)}
        </span>
      </div>
      ${detailBlock(ui().contractEvidence, finding.source || ui().noEvidence)}
      ${detailBlock(ui().commentPreview, finding.comment)}
      ${finding.redline ? detailBlock(ui().recommendedWording, finding.redline) : ""}
      <div class="action-row action-row-wide">
        <button type="button" data-action="find-product-finding" data-finding="${escapeAttr(finding.id)}">
          ${icon("target")}${escapeHtml(ui().findInWord)}
        </button>
        <button type="button" data-action="comment-product-finding" data-finding="${escapeAttr(finding.id)}" ${documentBusy || !state.capabilities.comments ? "disabled" : ""}>
          ${icon("comment")}${escapeHtml(ui().addComment)}
        </button>
      </div>
      <div class="action-row action-row-wide">
        <button type="button" data-action="redline-product-finding" data-finding="${escapeAttr(finding.id)}" ${documentBusy || !canRedline ? "disabled" : ""}>
          ${icon("branch")}${escapeHtml(ui().applyRedline)}
        </button>
        <button type="button" data-action="redline-comment-product-finding" data-finding="${escapeAttr(finding.id)}" ${documentBusy || !canRedline || !state.capabilities.comments ? "disabled" : ""}>
          ${icon("spark")}${escapeHtml(ui().applyRedlineComment)}
        </button>
      </div>
    </article>
  `;
}

function metricsHtml(session: TabularReviewSession) {
  const copy = ui();
  return `
    <dl class="metric-grid">
      ${metric(copy.contracts, session.metrics.contract_count)}
      ${metric(copy.rows, session.metrics.matched_clause_count)}
      ${metric(copy.averageDeviation, session.metrics.average_deviation.toFixed(2))}
      ${metric(copy.fallbackRows, session.metrics.fallback_rows)}
      ${metric(copy.redLines, session.metrics.red_line_breaches, session.metrics.red_line_breaches > 0 ? "danger" : "")}
    </dl>
  `;
}

function metric(label: string, value: string | number, tone = "") {
  return `<div class="metric ${tone}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`;
}

function sessionSelectHtml() {
  const locale = state.locale === "de" ? "de-DE" : "en-US";
  return `
    <select id="reviewSession" class="select-input">
      ${state.reviewSessions
        .map((session) => {
          const label = `${new Date(session.created_at).toLocaleString(locale)} · ${session.metrics.contract_count} ${ui().contracts.toLowerCase()} · ${session.metrics.matched_clause_count} ${ui().rows.toLowerCase()}`;
          return option(session.session_id, label, state.reviewSession?.session_id ?? "");
        })
        .join("")}
    </select>
  `;
}

function reviewRowCard(row: TabularReviewRow) {
  const copy = ui();
  const selected = currentRow()?.row_id === row.row_id;
  return `
    <button type="button" class="review-row ${selected ? "active" : ""}" data-row="${escapeAttr(row.row_id)}" title="${escapeAttr(copy.findInWord)}">
      <span class="outcome-pill ${toneForOutcome(row.outcome)}">${escapeHtml(copy.outcomeLabel(row.outcome))}</span>
      <span class="review-row-title">${escapeHtml(row.clause_name)}</span>
      <span class="review-row-meta">${escapeHtml(row.file_name)} · ${escapeHtml(copy.confidenceLabel(row.confidence))} · ${escapeHtml(row.applied ? copy.applied : copy.notApplied)}</span>
    </button>
  `;
}

function askPanel() {
  const copy = ui();
  return `
    <section class="panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">${copy.askEyebrow}</p>
          <h2>${copy.askHeading}</h2>
        </div>
        <button class="icon-button" type="button" data-action="read-selection" title="${copy.readSelection}">
          ${icon("clipboard")}
        </button>
      </div>

      <div class="selection-box">
        <span>${copy.selectionHeading}</span>
        <p>${escapeHtml(previewText(state.selectedText || copy.askSelectionPrompt, 280))}</p>
      </div>

      <form class="question-form" data-form="ask">
        <label for="question">${copy.questionLabel}</label>
        <textarea id="question" rows="4" placeholder="${escapeAttr(copy.questionPlaceholder)}">${escapeHtml(state.question)}</textarea>
        <button class="primary-button" type="submit" ${state.askStatus === "loading" ? "disabled" : ""}>
          ${state.askStatus === "loading" ? icon("loader", "spin") : icon("send")}
          ${escapeHtml(copy.askButton)}
        </button>
      </form>

      ${state.answer ? answerCard(state.answer) : ""}
    </section>
  `;
}

function answerCard(answer: QuestionResponse) {
  const copy = ui();
  const comment = buildAskComment(answer);
  const canInsertClause = Boolean(answer.suggestedClause?.trim());
  const canComment = state.capabilities.comments;
  const canRedline = Boolean(answer.suggestedClause?.trim()) && state.capabilities.changeTracking;
  const documentBusy = state.documentActionStatus === "loading";

  return `
    <article class="answer-card ${answer.escalationRequired ? "escalation" : ""}">
      ${
        answer.escalationRequired
          ? `<div class="escalation-banner">${icon("alert")}<span>${copy.escalationRequired}</span></div>`
          : ""
      }
      <div class="result-title">${icon("spark")}<span>${copy.answerTitle}</span></div>
      <p>${escapeHtml(answer.answer)}</p>
      <dl class="answer-meta">
        <div><dt>${copy.clause}</dt><dd>${escapeHtml(answer.clauseRef ?? copy.notIdentified)}</dd></div>
        <div><dt>${copy.position}</dt><dd>${escapeHtml(answer.positionUsed ? copy.positionLabel(answer.positionUsed) : copy.unknown)}</dd></div>
      </dl>
      ${answer.nextAction ? `<div class="next-action">${escapeHtml(answer.nextAction)}</div>` : ""}
      ${answer.suggestedClause ? detailBlock(copy.recommendedWording, answer.suggestedClause) : ""}
      ${detailBlock(copy.commentPreview, comment)}
      <div class="action-row action-row-wide">
        <button type="button" data-action="insert-answer">${icon("plus")}${escapeHtml(copy.insertAnswer)}</button>
        <button type="button" data-action="insert-clause" ${canInsertClause ? "" : "disabled"}>${icon("plus")}${escapeHtml(copy.insertClause)}</button>
      </div>
      <div class="action-row action-row-wide">
        <button type="button" data-action="comment-answer" ${documentBusy || !canComment ? "disabled" : ""}>${icon("comment")}${escapeHtml(copy.addComment)}</button>
        <button type="button" data-action="redline-answer" ${documentBusy || !canRedline ? "disabled" : ""}>${icon("branch")}${escapeHtml(copy.applyRedline)}</button>
      </div>
      <div class="action-row action-row-wide">
        <button type="button" data-action="redline-comment-answer" ${documentBusy || !canRedline || !canComment ? "disabled" : ""}>${icon("spark")}${escapeHtml(copy.applyRedlineComment)}</button>
        <button type="button" data-action="refresh-word-state">${icon("refresh")}${escapeHtml(copy.refreshWordState)}</button>
      </div>
      ${
        answer.escalationRequired
          ? `
            <form class="question-form escalation-form" data-form="escalation">
              <label for="escalationReason">${copy.reason}</label>
              <textarea id="escalationReason" rows="3" placeholder="${escapeAttr(copy.escalationPlaceholder)}">${escapeHtml(state.escalationReason)}</textarea>
              <button class="danger-button" type="submit" ${state.escalationStatus === "loading" ? "disabled" : ""}>
                ${state.escalationStatus === "loading" ? icon("loader", "spin") : icon("alert")}
                ${escapeHtml(copy.escalate)}
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

function detailBlock(title: string, body: string) {
  return `
    <div class="detail-block">
      <span>${escapeHtml(title)}</span>
      <p>${escapeHtml(body)}</p>
    </div>
  `;
}

function groundingHtml(items: string[]) {
  if (!items.length) return "";
  return `
    <details class="grounding">
      <summary>${escapeHtml(ui().showGrounding)}</summary>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </details>
  `;
}

function bindEvents() {
  document.querySelectorAll<HTMLButtonElement>("[data-locale]").forEach((button) => {
    button.addEventListener("click", () => {
      state.locale = (button.dataset.locale as Locale) ?? "en";
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab as Tab;
      state.error = "";
      state.notice = "";
      render();
      if (state.activeTab === "review" && state.reviewSessions.length === 0) {
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
      if (action === "product-word-review") void handleProductWordReview();
      if (action === "refresh-sessions") void handleRefreshSessions();
      if (action === "refresh-word-state") void refreshWordContext();
      if (action === "insert-answer") void handleInsert(state.answer?.answer);
      if (action === "insert-clause") void handleInsert(state.answer?.suggestedClause);
      if (action === "comment-answer") void handleCommentAnswer();
      if (action === "redline-answer") void handleRedlineAnswer(false);
      if (action === "redline-comment-answer") void handleRedlineAnswer(true);
      if (action === "set-tracking-mine") void handleSetTrackingMode("TrackMineOnly");
      if (action === "set-tracking-all") void handleSetTrackingMode("TrackAll");
      if (action === "set-tracking-off") void handleSetTrackingMode("Off");
      if (action === "accept-selection-changes") void handleSelectionChanges("accept");
      if (action === "reject-selection-changes") void handleSelectionChanges("reject");
      if (action === "find-review-match") void handleFindReviewMatch();
      if (action === "comment-review-row") void handleReviewSuggestion(false);
      if (action === "redline-review-row") void handleReviewSuggestion("redline");
      if (action === "redline-comment-review-row") void handleReviewSuggestion("redline-comment");
      if (action === "find-product-finding") void handleFindProductFinding(button.dataset.finding);
      if (action === "comment-product-finding") void handleProductFindingSuggestion(button.dataset.finding, false);
      if (action === "redline-product-finding") void handleProductFindingSuggestion(button.dataset.finding, "redline");
      if (action === "redline-comment-product-finding") void handleProductFindingSuggestion(button.dataset.finding, "redline-comment");
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
    await selectTextInDocument([row.evidence, row.clause_name, row.clause_type], row.row_id);
    await refreshWordContext(true);
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
    state.notice = ui().selectionLoaded;
    await refreshWordContext(true);
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
    state.notice = ui().documentLoaded;
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
      fileName: state.contractSource === "selection" ? ui().wordSelectionFile : ui().wordDocumentFile,
    });
    state.selectedRowId = state.reviewSession.rows[0]?.row_id ?? null;
    state.reviewStatus = "success";
    state.notice =
      state.reviewSession.rows.length > 0
        ? ui().reviewCreated(state.reviewSession.rows.length)
        : ui().reviewNoMatches;
    await handleRefreshSessions(true);
    await loadClauseForRow(currentRow());
  } catch (error) {
    state.reviewStatus = "error";
    state.error = messageFromError(error);
  }
  render();
}

async function handleProductWordReview() {
  if (!state.contractText.trim()) {
    await handleReadDocument();
    if (!state.contractText.trim()) return;
  }
  state.reviewStatus = "loading";
  state.error = "";
  state.notice = "";
  render();
  try {
    state.productReviewSession = await reviewWordProduct({
      documentText: state.contractText,
      actor: "Word Add-in User",
      wordContextAvailable: state.wordAvailable,
    });
    state.reviewStatus = "success";
    state.notice = ui().productReviewCreated(state.productReviewSession.findings.length);
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
      question: state.question || ui().wordAddinAnswer,
      answer: state.answer,
      reason: state.escalationReason,
    });
    const notification = response.notification_result?.status ?? ui().queued;
    state.escalationNotice = ui().escalationQueued(notification);
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
    state.notice = ui().insertedIntoWord;
    await refreshWordContext(true);
  } catch (error) {
    state.error = messageFromError(error);
  }
  render();
}

async function handleCommentAnswer() {
  if (!state.answer) return;
  await withDocumentAction(async () => {
    await insertCommentOnSelection(buildAskComment(state.answer as QuestionResponse));
    state.notice = ui().commentAdded;
    await refreshWordContext(true);
  });
}

async function handleRedlineAnswer(withComment: boolean) {
  if (!state.answer?.suggestedClause?.trim()) return;
  await withDocumentAction(async () => {
    await replaceSelectionWithTrackedText(state.answer?.suggestedClause ?? "", {
      commentText: withComment ? buildAskComment(state.answer as QuestionResponse) : undefined,
    });
    state.notice = withComment ? ui().redlineAndCommentApplied : ui().redlineApplied;
    await refreshWordContext(true);
  });
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

async function handleSetTrackingMode(mode: ChangeTrackingMode) {
  state.trackingStatus = "loading";
  state.error = "";
  state.notice = "";
  render();
  try {
    await setChangeTrackingMode(mode);
    await refreshWordContext(true);
    state.notice = ui().trackingModeUpdated(changeTrackingModeLabel(mode));
    state.trackingStatus = "success";
  } catch (error) {
    state.trackingStatus = "error";
    state.error = messageFromError(error);
  }
  render();
}

async function handleSelectionChanges(action: "accept" | "reject") {
  state.trackingStatus = "loading";
  state.error = "";
  state.notice = "";
  render();
  try {
    if (action === "accept") {
      await acceptTrackedChangesInSelection();
      state.notice = ui().trackedChangesAccepted;
    } else {
      await rejectTrackedChangesInSelection();
      state.notice = ui().trackedChangesRejected;
    }
    await refreshWordContext(true);
    state.trackingStatus = "success";
  } catch (error) {
    state.trackingStatus = "error";
    state.error = messageFromError(error);
  }
  render();
}

async function handleFindReviewMatch() {
  const row = currentRow();
  if (!row) return;
  await withDocumentAction(async () => {
    await selectTextInDocument([row.evidence, row.clause_name, row.clause_type], row.row_id);
    state.notice = ui().matchedClauseSelected;
    await refreshWordContext(true);
  });
}

async function handleFindProductFinding(findingId: string | undefined) {
  const finding = productFindingById(findingId);
  if (!finding) return;
  await withDocumentAction(async () => {
    await selectTextInDocument([finding.source, finding.clause_ref, finding.issue], finding.id);
    state.notice = ui().matchedClauseSelected;
    await refreshWordContext(true);
  });
}

async function handleProductFindingSuggestion(
  findingId: string | undefined,
  mode: false | "redline" | "redline-comment",
) {
  const finding = productFindingById(findingId);
  if (!finding) return;
  await withDocumentAction(async () => {
    await applySuggestionToMatchedText({
      anchorKey: finding.id,
      searchTerms: [finding.source, finding.clause_ref, finding.issue],
      replacementText: mode ? finding.redline ?? undefined : undefined,
      commentText: mode === "redline-comment" || mode === false ? buildProductReviewComment(finding) : undefined,
      trackingMode: "TrackMineOnly",
    });
    state.notice =
      mode === "redline-comment"
        ? ui().redlineAndCommentApplied
        : mode === "redline"
          ? ui().redlineApplied
          : ui().commentAdded;
    await refreshWordContext(true);
  });
}

async function handleReviewSuggestion(mode: false | "redline" | "redline-comment") {
  const row = currentRow();
  if (!row) return;
  const suggestion = buildReviewSuggestion(row, state.selectedReviewClause);
  if (!suggestion) return;

  await withDocumentAction(async () => {
    await applySuggestionToMatchedText({
      anchorKey: row.row_id,
      searchTerms: [row.evidence, row.clause_name, row.clause_type],
      replacementText: mode ? suggestion.recommendedText ?? undefined : undefined,
      commentText: mode === "redline-comment" || mode === false ? suggestion.comment : undefined,
      trackingMode: "TrackMineOnly",
    });
    state.notice =
      mode === "redline-comment"
        ? ui().redlineAndCommentApplied
        : mode === "redline"
          ? ui().redlineApplied
          : ui().commentAdded;
    await refreshWordContext(true);
  });
}

async function refreshWordContext(renderAfter = true) {
  if (!state.wordAvailable) return;
  try {
    state.capabilities = await getWordCapabilities();
    state.reviewedText = state.capabilities.reviewedText ? await getReviewedTextSnapshotSafe() : null;
  } catch (error) {
    state.error = messageFromError(error);
  }
  if (renderAfter) render();
}

async function getReviewedTextSnapshotSafe() {
  try {
    return await getReviewedTextForSelection();
  } catch {
    return null;
  }
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

async function withDocumentAction(work: () => Promise<void>) {
  state.documentActionStatus = "loading";
  state.error = "";
  state.notice = "";
  render();
  try {
    await work();
    state.documentActionStatus = "success";
  } catch (error) {
    state.documentActionStatus = "error";
    state.error = messageFromError(error);
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

function productFindingById(findingId: string | undefined) {
  if (!findingId) return null;
  return state.productReviewSession?.findings.find((finding) => finding.id === findingId) ?? null;
}

function preferredReviewSession(sessions: TabularReviewSession[]) {
  return sessions.find((session) => session.rows.length > 0) ?? sessions[0] ?? null;
}

function buildReviewSuggestion(
  row: TabularReviewRow,
  clause: PlaybookClause | null,
): ReviewSuggestion | null {
  if (!clause) return null;

  const candidates = uniqueNonEmpty([
    clause.positions?.preferred,
    row.outcome === "red_line_breached" ? clause.positions?.fallback_1 : undefined,
    row.outcome === "fallback_2" ? clause.positions?.fallback_1 : undefined,
    clause.positions?.fallback_1,
    clause.positions?.fallback_2,
  ]);
  const evidenceText = normalizeComparable(row.evidence);
  const recommendedText =
    candidates.find((candidate) => normalizeComparable(candidate) !== evidenceText) ??
    candidates[0] ??
    null;

  const canRedline = Boolean(recommendedText);
  const rationale = canRedline
    ? ui().reviewRecommendation(row.outcome, row.confidence)
    : ui().reviewCommentOnly;

  return {
    recommendedText,
    recommendationLabel: clause.name,
    canRedline,
    rationale,
    comment: buildReviewComment(row, clause, recommendedText),
  };
}

function buildReviewComment(
  row: TabularReviewRow,
  clause: PlaybookClause,
  recommendedText: string | null,
) {
  const copy = ui();
  const lines = [
    `${copy.commentClause}: ${row.clause_name} (${row.clause_id})`,
    `${copy.commentOutcome}: ${copy.outcomeLabel(row.outcome)}`,
    `${copy.commentConfidence}: ${copy.confidenceLabel(row.confidence)}`,
    `${copy.commentReason}: ${row.rationale || copy.noRationale}`,
  ];

  if (recommendedText) {
    lines.push(`${copy.commentSuggested}: ${recommendedText}`);
  } else if (clause.positions?.preferred) {
    lines.push(`${copy.commentSuggested}: ${clause.positions.preferred}`);
  }

  if (clause.red_line) {
    lines.push(`${copy.commentRedLine}: ${clause.red_line}`);
  }

  return lines.join("\n");
}

function buildProductReviewComment(finding: ProductReviewFinding) {
  const copy = ui();
  const lines = [
    `${copy.commentClause}: ${finding.clause_ref}`,
    `${copy.commentOutcome}: ${finding.severity}`,
    `${copy.commentConfidence}: ${Math.round(finding.confidence * 100)}%`,
    `${copy.commentReason}: ${finding.issue}`,
    `${copy.contractEvidence}: ${finding.source || copy.noEvidence}`,
  ];
  if (finding.redline) {
    lines.push(`${copy.commentSuggested}: ${finding.redline}`);
  }
  return lines.join("\n");
}

function buildAskComment(answer: QuestionResponse) {
  const copy = ui();
  const lines = [
    `${copy.commentQuestion}: ${state.question || copy.wordAddinAnswer}`,
    `${copy.commentClause}: ${answer.clauseRef ?? copy.notIdentified}`,
    `${copy.commentPosition}: ${answer.positionUsed ? copy.positionLabel(answer.positionUsed) : copy.unknown}`,
    `${copy.commentAnswer}: ${answer.answer}`,
  ];
  if (answer.nextAction) {
    lines.push(`${copy.commentNextAction}: ${answer.nextAction}`);
  }
  if (answer.suggestedClause) {
    lines.push(`${copy.commentSuggested}: ${answer.suggestedClause}`);
  }
  return lines.join("\n");
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function option(value: string, label: string, currentValue: string) {
  return `<option value="${escapeAttr(value)}" ${currentValue === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function toneForOutcome(outcome: TabularReviewRow["outcome"]) {
  if (outcome === "red_line_breached") return "red";
  if (outcome === "fallback_2") return "orange";
  if (outcome === "fallback_1") return "amber";
  return "green";
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

function normalizeComparable(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : ui().unexpectedError;
}

function detectLocale(): Locale {
  const language =
    Office?.context?.displayLanguage ??
    Office?.context?.contentLanguage ??
    navigator.language ??
    "en-US";
  return language.toLowerCase().startsWith("de") ? "de" : "en";
}

function changeTrackingModeLabel(mode: ChangeTrackingMode | null) {
  if (mode === "TrackAll") return ui().trackAll;
  if (mode === "TrackMineOnly") return ui().trackMineOnly;
  return ui().trackOff;
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
    branch: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    check: '<path d="M9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    close: '<path d="m18 6-12 12"/><path d="m6 6 12 12"/>',
    comment: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8"/><path d="M8 13h5"/>',
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
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v2"/><path d="M12 19v2"/><path d="M3 12h2"/><path d="M19 12h2"/>',
  };
  return `<svg ${attrs}>${paths[name] ?? paths.file}</svg>`;
}

function ui() {
  return state.locale === "de" ? COPY_DE : COPY_EN;
}

const COPY_EN = {
  brand: "Livebook",
  title: "Word add-in",
  language: "Language",
  modes: "Livebook modes",
  reviewTab: "Review",
  askTab: "Ask",
  wordRequired: "Document actions are available when this pane is opened from Microsoft Word.",
  wordConnected: "Word connected",
  browserOnly: "Browser only",
  noCommentsSupport: "Native Word comments are not available in this host.",
  noTrackingSupport: "Track Changes controls are not available in this host.",
  reviewEyebrow: "Contract Review",
  reviewHeading: "Review and redline Word content",
  refreshSessions: "Refresh sessions",
  readSelection: "Read selected text",
  readDocument: "Read whole document",
  selectionLabel: "Selection",
  documentLabel: "Document",
  words: "words",
  reviewReadPrompt: "Read the Word document or selected text before running a review.",
  runningReview: "Running review",
  runReview: "Run review",
  runReviewAgain: "Run review again",
  runProductReview: "Run full-document review",
  productReviewHeading: "Full-document findings",
  allOutcomes: "All outcomes",
  allConfidence: "All confidence",
  unknownCounterparty: "Unknown counterparty",
  rows: "rows",
  noSelectedRow: "Select a review row to inspect or apply a Word change.",
  noReviewSession: "No review session selected.",
  contractEvidence: "Contract evidence",
  rationale: "Rationale",
  noEvidence: "No evidence",
  noRationale: "No rationale",
  wordSuggestion: "Word suggestion",
  recommendedWording: "Recommended wording",
  noSuggestedWording: "No wording delta available from the playbook for this row.",
  commentPreview: "Comment preview",
  counterparty: "Counterparty",
  confidence: "Confidence",
  deviation: "Deviation",
  playbookContext: "Playbook context",
  preferred: "Preferred",
  fallback1: "Fallback 1",
  fallback2: "Fallback 2",
  redLine: "Red line",
  escalation: "Escalation",
  notSet: "Not set",
  contracts: "Contracts",
  averageDeviation: "Avg Dev",
  fallbackRows: "Fallbacks",
  redLines: "Red lines",
  searchPlaceholder: "Search contract, counterparty, clause, evidence, rationale...",
  applied: "Applied",
  notApplied: "Not applied",
  askEyebrow: "Livebook Chat",
  askHeading: "Ask and apply contract guidance",
  askSelectionPrompt: "Read a Word selection if you want to comment on or replace specific text.",
  questionLabel: "Question",
  questionPlaceholder: "Ask about clauses, fallback positions, or what wording to use...",
  askButton: "Ask Livebook",
  answerTitle: "Grounded answer",
  escalationRequired: "Escalation required",
  clause: "Clause",
  position: "Position",
  notIdentified: "Not identified",
  unknown: "Unknown",
  insertAnswer: "Insert answer",
  insertClause: "Insert clause",
  addComment: "Add comment",
  applyRedline: "Apply redline",
  applyRedlineComment: "Redline + comment",
  refreshWordState: "Refresh Word state",
  reason: "Reason",
  escalationPlaceholder: "Why should Legal Counsel review this?",
  escalate: "Escalate",
  showGrounding: "Show grounding",
  wordToolsEyebrow: "Word controls",
  wordToolsHeading: "Comments and Track Changes",
  commentsCapability: (ready: boolean) => (ready ? "Comments ready" : "Comments unavailable"),
  trackingCapability: (ready: boolean) => (ready ? "Track Changes ready" : "Track Changes unavailable"),
  acceptRejectCapability: (ready: boolean) => (ready ? "Accept / reject ready" : "Accept / reject unavailable"),
  trackMineOnly: "Track my changes",
  trackAll: "Track all changes",
  trackOff: "Tracking off",
  acceptSelectionChanges: "Accept selection changes",
  rejectSelectionChanges: "Reject selection changes",
  noSelectionSnapshot: "Select text in Word to inspect current and original reviewed text.",
  selectionEyebrow: "Selection snapshot",
  selectionHeading: "Tracked text preview",
  selectionCurrent: "Current text",
  selectionOriginal: "Original text",
  selectionLoaded: "Loaded the current Word selection.",
  documentLoaded: "Loaded the current Word document.",
  reviewCreated: (count: number) => `Review session created with ${count} row${count === 1 ? "" : "s"}.`,
  productReviewCreated: (count: number) => `Full-document review returned ${count} finding${count === 1 ? "" : "s"}.`,
  reviewNoMatches: "Review completed, but no playbook clauses matched this Word content.",
  insertedIntoWord: "Inserted into the Word document.",
  commentAdded: "Added a native Word comment.",
  redlineApplied: "Applied a tracked Word redline.",
  redlineAndCommentApplied: "Applied a tracked Word redline and comment.",
  escalationQueued: (notification: string) => `Queued for review; notification ${notification}.`,
  trackingModeUpdated: (mode: string) => `Change tracking is now set to ${mode}.`,
  trackedChangesAccepted: "Accepted tracked changes in the current selection.",
  trackedChangesRejected: "Rejected tracked changes in the current selection.",
  matchedClauseSelected: "Selected the matched clause in Word.",
  reviewRecommendation: (outcome: string, confidence: string) =>
    `Replace the matched clause with stronger playbook wording. Current outcome: ${formatOutcomeLabel("en", outcome)}. Confidence: ${formatConfidenceLabel("en", confidence)}.`,
  reviewCommentOnly: "No better replacement text is available, but you can still add a native Word comment.",
  positionLabel: (value: string) => formatPositionLabel("en", value),
  outcomeLabel: (value: string) => formatOutcomeLabel("en", value),
  confidenceLabel: (value: string) => formatConfidenceLabel("en", value),
  commentQuestion: "Question",
  commentClause: "Clause",
  commentPosition: "Position",
  commentAnswer: "Answer",
  commentNextAction: "Next action",
  commentOutcome: "Outcome",
  commentConfidence: "Confidence",
  commentReason: "Reason",
  commentSuggested: "Suggested wording",
  commentRedLine: "Red line",
  wordSelectionFile: "Word selection",
  wordDocumentFile: "Word document",
  wordAddinAnswer: "Word add-in answer",
  queued: "queued",
  findInWord: "Find in Word",
  unexpectedError: "Unexpected Livebook error",
};

const COPY_DE = {
  brand: "Livebook",
  title: "Word-Add-in",
  language: "Sprache",
  modes: "Livebook-Modi",
  reviewTab: "Prüfen",
  askTab: "Fragen",
  wordRequired: "Dokumentaktionen sind verfügbar, wenn dieses Panel aus Microsoft Word geöffnet wird.",
  wordConnected: "Word verbunden",
  browserOnly: "Nur Browser",
  noCommentsSupport: "Native Word-Kommentare sind in diesem Host nicht verfügbar.",
  noTrackingSupport: "Track-Changes-Steuerung ist in diesem Host nicht verfügbar.",
  reviewEyebrow: "Vertragsprüfung",
  reviewHeading: "Word-Inhalt prüfen und redlinen",
  refreshSessions: "Sessions aktualisieren",
  readSelection: "Auswahl lesen",
  readDocument: "Ganzes Dokument lesen",
  selectionLabel: "Auswahl",
  documentLabel: "Dokument",
  words: "Wörter",
  reviewReadPrompt: "Lies zuerst das Word-Dokument oder die aktuelle Auswahl ein, bevor du eine Prüfung startest.",
  runningReview: "Prüfung läuft",
  runReview: "Prüfung starten",
  runReviewAgain: "Prüfung erneut starten",
  runProductReview: "Ganzdokumentprüfung starten",
  productReviewHeading: "Ganzdokument-Findings",
  allOutcomes: "Alle Ergebnisse",
  allConfidence: "Alle Sicherheiten",
  unknownCounterparty: "Unbekannte Gegenpartei",
  rows: "Zeilen",
  noSelectedRow: "Wähle eine Prüfzeile aus, um sie zu prüfen oder in Word anzuwenden.",
  noReviewSession: "Keine Review-Session ausgewählt.",
  contractEvidence: "Vertragstext",
  rationale: "Begründung",
  noEvidence: "Keine Evidenz",
  noRationale: "Keine Begründung",
  wordSuggestion: "Word-Vorschlag",
  recommendedWording: "Empfohlene Formulierung",
  noSuggestedWording: "Für diese Zeile gibt es aus dem Playbook keine bessere Formulierungsdifferenz.",
  commentPreview: "Kommentarvorschau",
  counterparty: "Gegenpartei",
  confidence: "Sicherheit",
  deviation: "Abweichung",
  playbookContext: "Playbook-Kontext",
  preferred: "Preferred",
  fallback1: "Fallback 1",
  fallback2: "Fallback 2",
  redLine: "Red Line",
  escalation: "Eskalation",
  notSet: "Nicht gesetzt",
  contracts: "Verträge",
  averageDeviation: "Ø Abw.",
  fallbackRows: "Fallbacks",
  redLines: "Red Lines",
  searchPlaceholder: "Vertrag, Gegenpartei, Klausel, Evidenz, Begründung durchsuchen...",
  applied: "Angewendet",
  notApplied: "Nicht angewendet",
  askEyebrow: "Livebook Chat",
  askHeading: "Fragen und Vertragsvorschläge anwenden",
  askSelectionPrompt: "Lies eine Word-Auswahl ein, wenn du konkreten Text kommentieren oder ersetzen willst.",
  questionLabel: "Frage",
  questionPlaceholder: "Frage nach Klauseln, Fallback-Positionen oder welcher Wortlaut verwendet werden soll...",
  askButton: "Livebook fragen",
  answerTitle: "Begründete Antwort",
  escalationRequired: "Eskalation erforderlich",
  clause: "Klausel",
  position: "Position",
  notIdentified: "Nicht erkannt",
  unknown: "Unbekannt",
  insertAnswer: "Antwort einfügen",
  insertClause: "Klausel einfügen",
  addComment: "Kommentar hinzufügen",
  applyRedline: "Redline anwenden",
  applyRedlineComment: "Redline + Kommentar",
  refreshWordState: "Word-Status aktualisieren",
  reason: "Grund",
  escalationPlaceholder: "Warum sollte Legal Counsel das prüfen?",
  escalate: "Eskalieren",
  showGrounding: "Begründung anzeigen",
  wordToolsEyebrow: "Word-Steuerung",
  wordToolsHeading: "Kommentare und Track Changes",
  commentsCapability: (ready: boolean) => (ready ? "Kommentare bereit" : "Kommentare nicht verfügbar"),
  trackingCapability: (ready: boolean) => (ready ? "Track Changes bereit" : "Track Changes nicht verfügbar"),
  acceptRejectCapability: (ready: boolean) => (ready ? "Annehmen / ablehnen bereit" : "Annehmen / ablehnen nicht verfügbar"),
  trackMineOnly: "Meine Änderungen tracken",
  trackAll: "Alle Änderungen tracken",
  trackOff: "Tracking aus",
  acceptSelectionChanges: "Änderungen in Auswahl annehmen",
  rejectSelectionChanges: "Änderungen in Auswahl ablehnen",
  noSelectionSnapshot: "Wähle Text in Word aus, um aktuelle und ursprüngliche Fassung zu sehen.",
  selectionEyebrow: "Auswahl-Snapshot",
  selectionHeading: "Vorschau mit Track Changes",
  selectionCurrent: "Aktueller Text",
  selectionOriginal: "Ursprünglicher Text",
  selectionLoaded: "Die aktuelle Word-Auswahl wurde geladen.",
  documentLoaded: "Das aktuelle Word-Dokument wurde geladen.",
  reviewCreated: (count: number) => `Review-Session mit ${count} Zeile${count === 1 ? "" : "n"} erstellt.`,
  productReviewCreated: (count: number) => `Ganzdokumentprüfung hat ${count} Finding${count === 1 ? "" : "s"} erzeugt.`,
  reviewNoMatches: "Prüfung abgeschlossen, aber es wurden keine passenden Playbook-Klauseln gefunden.",
  insertedIntoWord: "In das Word-Dokument eingefügt.",
  commentAdded: "Ein nativer Word-Kommentar wurde hinzugefügt.",
  redlineApplied: "Eine getrackte Word-Redline wurde angewendet.",
  redlineAndCommentApplied: "Eine getrackte Word-Redline mit Kommentar wurde angewendet.",
  escalationQueued: (notification: string) => `Zur Prüfung eingereiht; Benachrichtigung ${notification}.`,
  trackingModeUpdated: (mode: string) => `Track Changes ist jetzt auf ${mode} gesetzt.`,
  trackedChangesAccepted: "Track-Changes in der aktuellen Auswahl wurden angenommen.",
  trackedChangesRejected: "Track-Changes in der aktuellen Auswahl wurden abgelehnt.",
  matchedClauseSelected: "Die gefundene Klausel wurde in Word markiert.",
  reviewRecommendation: (outcome: string, confidence: string) =>
    `Ersetze die gefundene Klausel durch stärkeren Playbook-Wortlaut. Aktuelles Ergebnis: ${formatOutcomeLabel("de", outcome)}. Sicherheit: ${formatConfidenceLabel("de", confidence)}.`,
  reviewCommentOnly: "Es gibt keinen besseren Ersatztext, aber du kannst trotzdem einen nativen Word-Kommentar setzen.",
  positionLabel: (value: string) => formatPositionLabel("de", value),
  outcomeLabel: (value: string) => formatOutcomeLabel("de", value),
  confidenceLabel: (value: string) => formatConfidenceLabel("de", value),
  commentQuestion: "Frage",
  commentClause: "Klausel",
  commentPosition: "Position",
  commentAnswer: "Antwort",
  commentNextAction: "Nächster Schritt",
  commentOutcome: "Ergebnis",
  commentConfidence: "Sicherheit",
  commentReason: "Begründung",
  commentSuggested: "Empfohlene Formulierung",
  commentRedLine: "Red Line",
  wordSelectionFile: "Word-Auswahl",
  wordDocumentFile: "Word-Dokument",
  wordAddinAnswer: "Word-Add-in-Antwort",
  queued: "queued",
  findInWord: "In Word finden",
  unexpectedError: "Unerwarteter Livebook-Fehler",
};

function formatOutcomeLabel(locale: Locale, value: string) {
  const labels = {
    en: {
      preferred: "Preferred",
      fallback_1: "Fallback 1",
      fallback_2: "Fallback 2",
      red_line_breached: "Red line",
    },
    de: {
      preferred: "Preferred",
      fallback_1: "Fallback 1",
      fallback_2: "Fallback 2",
      red_line_breached: "Red Line",
    },
  };
  return labels[locale][value as keyof (typeof labels)["en"]] ?? value;
}

function formatConfidenceLabel(locale: Locale, value: string) {
  const labels = {
    en: { high: "High", medium: "Medium", low: "Low" },
    de: { high: "Hoch", medium: "Mittel", low: "Niedrig" },
  };
  return labels[locale][value as keyof (typeof labels)["en"]] ?? value;
}

function formatPositionLabel(locale: Locale, value: string) {
  const normalized = value.replace(/_/g, " ");
  if (locale === "de") {
    if (normalized.toLowerCase() === "preferred") return "Preferred";
    if (normalized.toLowerCase() === "fallback 1") return "Fallback 1";
    if (normalized.toLowerCase() === "fallback 2") return "Fallback 2";
    if (normalized.toLowerCase() === "red line breached") return "Red Line";
  }
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
