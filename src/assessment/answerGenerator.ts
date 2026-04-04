/**
 * Invokes the backend LLM to produce structured assessment answers.
 */

import { tauriInvoke } from "../lib/tauri";
import type { AssessmentResult } from "./types";

export async function solveFromScreenshot(
  imageBase64Png: string,
  interviewContext?: string
): Promise<AssessmentResult> {
  return tauriInvoke<AssessmentResult>("assessment_analyze_image", {
    imageBase64Png,
    interviewContext: interviewContext?.trim() || undefined,
  });
}

export async function solveFromQuestionText(
  text: string,
  interviewContext?: string
): Promise<AssessmentResult> {
  return tauriInvoke<AssessmentResult>("assessment_analyze_text", {
    text: text.trim(),
    interviewContext: interviewContext?.trim() || undefined,
  });
}
