/**
 * Lightweight client-side classification from plain text (fast fallback / UX labels).
 * The authoritative type from vision+LLM is still preferred when available.
 */

import type { QuestionType } from "./types";

const MCQ_HINTS =
  /\b([A-Da-d][\).\:]\s|option\s+[1-4]|choose\s+(one|the|correct)|select\s+(one|the|all)|multiple\s*choice)\b/i;
const TRUE_FALSE = /\b(true|false)\b.*\b(true|false)\b|\b(T\/F|true\s*or\s*false)\b/i;
const FILL_BLANK = /_{3,}|\\\{\\}|\\\.\\.\\\.|\[blank\]|fill\s+in\s+the\s+blank/i;
const CODE_OUTPUT = /\boutput\b|\bprint(s)?\b|\bconsole\.log\b|\bwhat\s+(does|will)\s+.*\b(print|output|display)\b/i;

export function classifyQuestionText(text: string): QuestionType {
  const t = text.trim();
  if (!t) return "unknown";
  if (CODE_OUTPUT.test(t) && /[;{}=()]/.test(t)) return "code_output";
  if (TRUE_FALSE.test(t)) return "true_false";
  if (FILL_BLANK.test(t)) return "fill_blank";
  if (MCQ_HINTS.test(t) || /^[A-Da-d][\).\:]/m.test(t)) return "mcq";
  if (/def\s+\w+\s*\(|function\s+\w+|class\s+\w+|import\s+\w+/.test(t)) return "short_programming";
  if (/\bpuzzle|pattern|sequence|next\s+(in|term|number)|which\s+shape\b/i.test(t)) return "logic";
  return "unknown";
}

/** Normalize server enum to our union when possible. */
export function normalizeQuestionType(raw: string): QuestionType {
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const allowed: QuestionType[] = [
    "mcq",
    "fill_blank",
    "true_false",
    "logic",
    "image_puzzle",
    "code_output",
    "short_programming",
    "unknown",
  ];
  return (allowed.includes(s as QuestionType) ? s : "unknown") as QuestionType;
}
