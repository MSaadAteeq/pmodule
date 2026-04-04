/**
 * Shared types for screen-capture assessment assist (screenshot-only; no keylogging).
 */

export type QuestionType =
  | "mcq"
  | "fill_blank"
  | "true_false"
  | "logic"
  | "image_puzzle"
  | "code_output"
  | "short_programming"
  | "unknown";

export type AssessmentResult = {
  questionType: QuestionType | string;
  extractedQuestion: string;
  correctAnswer: string;
  briefExplanation: string;
};

export type CaptureRegionPhysical = {
  x: number;
  y: number;
  width: number;
  height: number;
};
