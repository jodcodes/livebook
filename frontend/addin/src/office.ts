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

export async function selectTextInDocument(candidates: string[]) {
  ensureWordHost();

  const searchTerms = buildSearchTerms(candidates);
  if (!searchTerms.length) {
    throw new Error("No clause evidence available to locate in the Word document.");
  }

  await Word.run(async (context) => {
    for (const term of searchTerms) {
      const results = context.document.body.search(term, {
        ignorePunct: true,
        ignoreSpace: true,
        matchCase: false,
      });
      results.load("text");
      await context.sync();

      if (results.items.length > 0) {
        results.items[0].select(Word.SelectionMode.select);
        await context.sync();
        return;
      }
    }

    throw new Error("Could not find matching clause text in the Word document.");
  });
}

function ensureWordHost() {
  if (!isWordHost()) {
    throw new Error("Open Livebook from Microsoft Word to read or write document content.");
  }
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
