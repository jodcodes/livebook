export type ChangeTrackingMode = "Off" | "TrackAll" | "TrackMineOnly";

export interface WordCapabilities {
  comments: boolean;
  changeTracking: boolean;
  reviewedText: boolean;
  trackedChanges: boolean;
  changeTrackingMode: ChangeTrackingMode | null;
}

export interface ReviewedTextSnapshot {
  selectionText: string;
  original: string;
  current: string;
}

interface MatchedEditRequest {
  anchorKey?: string;
  searchTerms: string[];
  replacementText?: string;
  commentText?: string;
  selectAfter?: boolean;
  trackingMode?: Extract<ChangeTrackingMode, "TrackAll" | "TrackMineOnly">;
}

interface MatchedEditResult {
  matchedText: string;
}

export function isWordHost() {
  return typeof Office !== "undefined" && typeof Word !== "undefined";
}

export async function initializeOffice() {
  if (!isWordHost()) return false;

  await new Promise<void>((resolve) => {
    Office.onReady(() => resolve());
  });
  return isWordHost();
}

export async function getWordCapabilities(): Promise<WordCapabilities> {
  if (!isWordHost()) {
    return {
      comments: false,
      changeTracking: false,
      reviewedText: false,
      trackedChanges: false,
      changeTrackingMode: null,
    };
  }

  const comments = supportsWordApi("1.4");
  const trackedChanges = supportsWordApi("1.6");
  let changeTrackingMode: ChangeTrackingMode | null = null;

  if (comments) {
    try {
      changeTrackingMode = await Word.run(async (context) => {
        const document = context.document;
        document.load("changeTrackingMode");
        await context.sync();
        return normalizeChangeTrackingMode(document.changeTrackingMode);
      });
    } catch {
      changeTrackingMode = null;
    }
  }

  return {
    comments,
    changeTracking: comments,
    reviewedText: comments,
    trackedChanges,
    changeTrackingMode,
  };
}

export async function readSelectedText() {
  ensureWordHost();

  return Word.run(async (context) => {
    const range = context.document.getSelection();
    const ooxml = readOoxml(range);
    range.load("text");
    await context.sync();
    return normalizeReviewText(textFromOoxml(ooxml?.value) || range.text);
  });
}

export async function readDocumentText() {
  ensureWordHost();

  return Word.run(async (context) => {
    const body = context.document.body;
    const ooxml = readOoxml(body);
    body.load("text");
    await context.sync();
    return normalizeReviewText(textFromOoxml(ooxml?.value) || body.text);
  });
}

export async function insertTextAfterSelection(text: string) {
  ensureWordHost();

  await Word.run(async (context) => {
    const range = context.document.getSelection();
    range.insertText(`\n${text}\n`, Word.InsertLocation.after);
    await context.sync();
  });
}

export async function insertCommentOnSelection(commentText: string) {
  ensureWordHost();
  ensureWordApi("1.4", "This version of Word does not support native comments from the add-in.");

  await Word.run(async (context) => {
    const range = context.document.getSelection();
    range.load("text");
    await context.sync();
    if (!range.text.trim()) {
      throw new Error("Select the text you want to comment on in Word first.");
    }
    range.insertComment(commentText.trim());
    await context.sync();
  });
}

export async function replaceSelectionWithTrackedText(
  text: string,
  options: {
    commentText?: string;
    trackingMode?: Extract<ChangeTrackingMode, "TrackAll" | "TrackMineOnly">;
  } = {},
) {
  ensureWordHost();
  ensureWordApi("1.4", "This version of Word does not support change tracking from the add-in.");

  await Word.run(async (context) => {
    const range = context.document.getSelection();
    range.load("text");
    await context.sync();

    if (!range.text.trim()) {
      throw new Error("Select the text you want to replace in Word first.");
    }

    await ensureTrackingModeInContext(context, options.trackingMode ?? "TrackMineOnly");

    if (options.commentText?.trim()) {
      range.insertComment(options.commentText.trim());
    }

    range.insertText(text.trim(), Word.InsertLocation.replace);
    range.select(Word.SelectionMode.select);
    await context.sync();
  });
}

export async function applySuggestionToMatchedText(
  input: MatchedEditRequest,
): Promise<MatchedEditResult> {
  ensureWordHost();

  if (input.commentText?.trim()) {
    ensureWordApi("1.4", "This version of Word does not support native comments from the add-in.");
  }
  if (input.replacementText?.trim()) {
    ensureWordApi("1.4", "This version of Word does not support change tracking from the add-in.");
  }

  const searchTerms = buildSearchTerms(input.searchTerms);
  if (!searchTerms.length) {
    throw new Error("No clause evidence available to locate in the Word document.");
  }

  return Word.run(async (context) => {
    const range = await findAnchoredOrMatchingRange(context, input.anchorKey, searchTerms);
    range.load("text");
    await context.sync();

    const matchedText = range.text;

    if (input.commentText?.trim()) {
      range.insertComment(input.commentText.trim());
    }

    if (input.replacementText?.trim()) {
      await ensureTrackingModeInContext(context, input.trackingMode ?? "TrackMineOnly");
      range.insertText(input.replacementText.trim(), Word.InsertLocation.replace);
    }

    if (input.selectAfter !== false) {
      range.select(Word.SelectionMode.select);
    }

    await context.sync();
    return { matchedText };
  });
}

export async function selectTextInDocument(candidates: string[], anchorKey?: string) {
  ensureWordHost();

  const searchTerms = buildSearchTerms(candidates);
  if (!searchTerms.length) {
    throw new Error("No clause evidence available to locate in the Word document.");
  }

  await Word.run(async (context) => {
    const range = await findAnchoredOrMatchingRange(context, anchorKey, searchTerms);
    range.select(Word.SelectionMode.select);
    await context.sync();
  });
}

export async function getReviewedTextForSelection(): Promise<ReviewedTextSnapshot> {
  ensureWordHost();
  ensureWordApi("1.4", "This version of Word does not support reviewed text snapshots.");

  return Word.run(async (context) => {
    const range = context.document.getSelection();
    range.load("text");
    const original = range.getReviewedText(Word.ChangeTrackingVersion.original);
    const current = range.getReviewedText(Word.ChangeTrackingVersion.current);
    await context.sync();
    return {
      selectionText: range.text,
      original: original.value,
      current: current.value,
    };
  });
}

export async function setChangeTrackingMode(mode: ChangeTrackingMode) {
  ensureWordHost();
  ensureWordApi("1.4", "This version of Word does not support change tracking controls.");

  await Word.run(async (context) => {
    context.document.changeTrackingMode = mode;
    await context.sync();
  });
}

export async function acceptTrackedChangesInSelection() {
  ensureWordHost();
  ensureWordApi("1.6", "This version of Word does not support accepting tracked changes from the add-in.");

  await Word.run(async (context) => {
    const range = context.document.getSelection();
    const trackedChanges = range.getTrackedChanges();
    trackedChanges.acceptAll();
    await context.sync();
  });
}

export async function rejectTrackedChangesInSelection() {
  ensureWordHost();
  ensureWordApi("1.6", "This version of Word does not support rejecting tracked changes from the add-in.");

  await Word.run(async (context) => {
    const range = context.document.getSelection();
    const trackedChanges = range.getTrackedChanges();
    trackedChanges.rejectAll();
    await context.sync();
  });
}

function ensureWordHost() {
  if (!isWordHost()) {
    throw new Error("Open Livebook from Microsoft Word to read or write document content.");
  }
}

function supportsWordApi(version: string) {
  return Boolean(Office?.context?.requirements?.isSetSupported?.("WordApi", version));
}

function ensureWordApi(version: string, message: string) {
  if (!supportsWordApi(version)) {
    throw new Error(message);
  }
}

async function ensureTrackingModeInContext(
  context: Word.RequestContext,
  desiredMode: Extract<ChangeTrackingMode, "TrackAll" | "TrackMineOnly">,
) {
  const document = context.document;
  document.load("changeTrackingMode");
  await context.sync();

  const currentMode = normalizeChangeTrackingMode(document.changeTrackingMode);
  if (currentMode === desiredMode || currentMode === "TrackAll") return currentMode;

  document.changeTrackingMode = desiredMode;
  await context.sync();
  return desiredMode;
}

async function findFirstMatchingRange(context: Word.RequestContext, searchTerms: string[]) {
  for (const term of searchTerms) {
    const results = context.document.body.search(term, {
      ignorePunct: true,
      ignoreSpace: true,
      matchCase: false,
    });
    results.load("text");
    await context.sync();

    if (results.items.length > 0) {
      return results.items[0];
    }
  }

  throw new Error("Could not find matching clause text in the Word document.");
}

async function findAnchoredOrMatchingRange(
  context: Word.RequestContext,
  anchorKey: string | undefined,
  searchTerms: string[],
) {
  const bookmarkName = anchorKey ? bookmarkNameForKey(anchorKey) : null;

  if (bookmarkName) {
    const anchored = await bookmarkRangeOrNullObject(context, bookmarkName);
    if (anchored) return anchored;
  }

  const range = await findFirstMatchingRange(context, searchTerms);

  if (!bookmarkName) return range;

  const persisted = await persistBookmarkForRange(context, range, bookmarkName);
  return persisted ?? range;
}

async function bookmarkRangeOrNullObject(
  context: Word.RequestContext,
  bookmarkName: string,
): Promise<Word.Range | null> {
  const documentWithBookmarks = context.document as unknown as {
    getBookmarkRangeOrNullObject?: (name: string) => Word.Range;
  };
  if (typeof documentWithBookmarks.getBookmarkRangeOrNullObject !== "function") {
    return null;
  }

  const range = documentWithBookmarks.getBookmarkRangeOrNullObject(bookmarkName);
  range.load("text");
  await context.sync();
  return range.isNullObject ? null : range;
}

async function persistBookmarkForRange(
  context: Word.RequestContext,
  range: Word.Range,
  bookmarkName: string,
): Promise<Word.Range | null> {
  const bookmarkableRange = range as unknown as { insertBookmark?: (name: string) => void };
  if (typeof bookmarkableRange.insertBookmark !== "function") {
    return null;
  }

  bookmarkableRange.insertBookmark(bookmarkName);
  await context.sync();
  return bookmarkRangeOrNullObject(context, bookmarkName);
}

function bookmarkNameForKey(key: string) {
  const safeStem =
    key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 28) || "anchor";
  return `_${safeStem}_${shortHash(key)}`.slice(0, 40);
}

function shortHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeChangeTrackingMode(value: string | undefined): ChangeTrackingMode | null {
  if (value === "TrackAll" || value === "TrackMineOnly" || value === "Off") return value;
  return null;
}

function readOoxml(source: unknown): { value: string } | null {
  const candidate = source as { getOoxml?: () => { value: string } };
  if (typeof candidate.getOoxml !== "function") return null;
  try {
    return candidate.getOoxml();
  } catch {
    return null;
  }
}

function textFromOoxml(ooxml: string | undefined) {
  if (!ooxml?.trim()) return "";
  const parser = new DOMParser();
  const packageDocument = parser.parseFromString(ooxml, "application/xml");
  if (packageDocument.querySelector("parsererror")) return "";

  const documentXml = extractDocumentXml(packageDocument) ?? ooxml;
  const wordDocument = parser.parseFromString(documentXml, "application/xml");
  if (wordDocument.querySelector("parsererror")) return "";

  return normalizeReviewText(
    Array.from(wordDocument.getElementsByTagNameNS("*", "body"))
      .flatMap(blocksFromNode)
      .join("\n\n"),
  );
}

function extractDocumentXml(packageDocument: Document) {
  const parts = Array.from(packageDocument.getElementsByTagNameNS("*", "part"));
  const documentPart = parts.find((part) => {
    const name = part.getAttribute("pkg:name") ?? part.getAttribute("name") ?? "";
    return name === "/word/document.xml";
  });
  const xmlData = documentPart?.getElementsByTagNameNS("*", "xmlData")[0];
  const document = xmlData?.getElementsByTagNameNS("*", "document")[0];
  return document ? new XMLSerializer().serializeToString(document) : null;
}

function blocksFromNode(node: Element): string[] {
  return Array.from(node.children).flatMap((child) => {
    if (child.localName === "p") {
      const paragraph = paragraphText(child);
      return paragraph ? [paragraph] : [];
    }
    if (child.localName === "tbl") {
      const table = tableText(child);
      return table ? [table] : [];
    }
    if (child.children.length > 0) return blocksFromNode(child);
    return [];
  });
}

function paragraphText(paragraph: Element) {
  return normalizeInlineText(
    Array.from(paragraph.getElementsByTagNameNS("*", "t"))
      .map((node) => node.textContent ?? "")
      .join(""),
  );
}

function tableText(table: Element) {
  const rows = Array.from(table.children)
    .filter((child) => child.localName === "tr")
    .map((row, rowIndex) => {
      const cells = Array.from(row.children)
        .filter((child) => child.localName === "tc")
        .map((cell) => blocksFromNode(cell).join(" ").trim())
        .filter(Boolean);
      return cells.length ? `Table row ${rowIndex + 1}: ${cells.join(" | ")}` : "";
    })
    .filter(Boolean);
  return rows.join("\n");
}

function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeReviewText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function buildSearchTerms(candidates: string[]) {
  const terms = candidates.flatMap((candidate) => searchTermVariants(candidate));
  return [...new Set(terms)];
}

function searchTermVariants(value: string) {
  const text = normalizeOfficeSearchText(value);
  if (text.length < 3) return [];

  const quoted = Array.from(text.matchAll(/["“”']([^"“”']{8,})["“”']/g), (match) => match[1]);
  const sentences = text
    .split(/[.!?;:]\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8);
  const titleParts = text
    .split(/[\/|–—-]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);

  return [text, ...quoted, ...sentences, ...titleParts]
    .map((term) => trimSearchTerm(term))
    .filter((term) => term.length >= 3);
}

function normalizeOfficeSearchText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^contract evidence:\s*/i, "")
    .trim();
}

function trimSearchTerm(value: string) {
  const maxLength = 180;
  const text = normalizeOfficeSearchText(value);
  if (text.length <= maxLength) return text;

  const shortened = text.slice(0, maxLength);
  const lastSpace = shortened.lastIndexOf(" ");
  return (lastSpace > 40 ? shortened.slice(0, lastSpace) : shortened).trim();
}
