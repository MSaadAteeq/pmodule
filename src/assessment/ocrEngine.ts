/**
 * Text extraction from screenshots using multimodal vision (OpenAI).
 * For local Tesseract/PaddleOCR, you could swap this module to call a native CLI or WASM build;
 * the rest of the pipeline stays the same.
 */

import { tauriInvoke } from "../lib/tauri";
import type { AssessmentResult } from "./types";

export async function extractQuestionViaVision(
  imageBase64Png: string,
  interviewContext?: string
): Promise<{ raw: AssessmentResult; ocrText: string }> {
  const raw = await tauriInvoke<AssessmentResult>("assessment_analyze_image", {
    imageBase64Png,
    interviewContext: interviewContext?.trim() || undefined,
  });
  return { raw, ocrText: raw.extractedQuestion ?? "" };
}
