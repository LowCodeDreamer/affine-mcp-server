import yaml from "js-yaml";

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(\n|$)/;

export type ParsedFrontmatter = {
  body: string;
  meta: Record<string, unknown>;
  warnings: string[];
  hadFrontmatter: boolean;
};

export function parseAtlasFrontmatter(markdown: string): ParsedFrontmatter {
  const warnings: string[] = [];
  if (typeof markdown !== "string" || markdown.length === 0) {
    return { body: markdown ?? "", meta: {}, warnings, hadFrontmatter: false };
  }

  const trimmed = markdown.startsWith("﻿") ? markdown.slice(1) : markdown;
  const match = FRONTMATTER_RE.exec(trimmed);
  if (!match) {
    return { body: trimmed, meta: {}, warnings, hadFrontmatter: false };
  }

  const raw = match[1] ?? "";
  const body = trimmed.slice(match[0].length).replace(/^\n+/, "");

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    warnings.push(`frontmatter parse failed: ${(err as Error).message}`);
    return { body, meta: {}, warnings, hadFrontmatter: true };
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    if (raw.trim().length > 0) {
      warnings.push("frontmatter is not a YAML mapping; ignored");
    }
    return { body, meta: {}, warnings, hadFrontmatter: true };
  }

  return {
    body,
    meta: parsed as Record<string, unknown>,
    warnings,
    hadFrontmatter: true,
  };
}

export function coerceDateMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    const iso = dateOnly.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export function coerceStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => (v == null ? "" : String(v)))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [String(value)];
}

export function coerceString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
