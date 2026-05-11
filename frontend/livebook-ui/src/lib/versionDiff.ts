export interface VersionLike {
  clauseId: string;
  versionNumber: number;
  versionId?: string;
  snapshot: Record<string, unknown>;
}

export interface VersionDiffRow {
  field: string;
  from: string;
  to: string;
}

const VERSION_ID_PATTERN = /\b(?:VER-[a-fA-F0-9]{16}|[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*:v\d+(?::[A-Za-z0-9_-]+)?)\b/g;

export function extractVersionIds(text: string) {
  return Array.from(new Set(text.match(VERSION_ID_PATTERN) ?? []));
}

export function getPreviousVersionItem<T extends VersionLike>(
  item: T,
  versions: T[]
) {
  return versions
    .filter(
      (candidate) =>
        candidate.clauseId === item.clauseId &&
        candidate.versionNumber < item.versionNumber
    )
    .sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null;
}

export function buildVersionDiffRows(
  from: Record<string, unknown> | null | undefined,
  to: Record<string, unknown> | null | undefined
) {
  const fields: Array<[string, string[]]> = [
    ["Name", ["name"]],
    ["Preferred", ["positions", "preferred"]],
    ["Fallback 1", ["positions", "fallback_1"]],
    ["Fallback 2", ["positions", "fallback_2"]],
    ["Red line", ["red_line"]],
    ["Escalation trigger", ["escalation_trigger"]],
    ["Always escalate", ["always_escalate"]],
    ["Keywords", ["keywords"]],
  ];

  return fields.flatMap(([field, path]) => {
    const fromValue = formatValue(valueAtPath(from, path));
    const toValue = formatValue(valueAtPath(to, path));
    if (fromValue === toValue) return [];
    return [{ field, from: fromValue, to: toValue }];
  });
}

export function diffWords(from: string, to: string) {
  const fromTokens = tokenize(from);
  const toTokens = tokenize(to);
  const common = new Set(fromTokens.filter((token) => toTokens.includes(token)));
  return {
    removed: fromTokens.map((token) => ({
      token,
      changed: !common.has(token),
    })),
    added: toTokens.map((token) => ({
      token,
      changed: !common.has(token),
    })),
  };
}

function valueAtPath(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Not set";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function tokenize(value: string): string[] {
  return value.match(/\S+\s*/g) ?? [];
}
