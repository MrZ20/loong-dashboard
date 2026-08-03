function normalize(value: string) {
  return value.trim().replace(/^\/+/, "").replace(/\\/g, "/").toLowerCase();
}

function globRegex(pattern: string) {
  const escaped = normalize(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}${pattern.endsWith("/") ? ".*" : "(?:$|/.*)"}`);
}

export function matchesPath(path: string, pattern: string) {
  const candidate = normalize(path);
  const rule = normalize(pattern);
  if (!candidate || !rule) return false;
  if (rule.includes("*")) return globRegex(rule).test(candidate);
  if (pattern.endsWith("/")) return candidate.startsWith(rule);
  return candidate === rule || candidate.startsWith(`${rule}/`);
}

export function pathSpecificity(pattern: string) {
  return normalize(pattern).replace(/\*/g, "").length;
}

export function textMentionsPath(text: string, pattern: string) {
  const normalizedText = text.toLowerCase();
  const normalizedPattern = normalize(pattern).replace(/\*.*$/, "").replace(/\/$/, "");
  if (normalizedPattern.length < 4) return false;
  return normalizedText.includes(normalizedPattern);
}
