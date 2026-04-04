import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { capturePrimaryScreenPngBase64 } from "../assessment/screenCapture";
import { normalizeQuestionType, classifyQuestionText } from "../assessment/questionClassifier";
import { solveFromQuestionText, solveFromScreenshot } from "../assessment/answerGenerator";
import type { AssessmentResult, CaptureRegionPhysical } from "../assessment/types";
import { isTauri } from "../lib/tauri";

export type UiAnswerPanelProps = {
  /** e.g. "Frontend (Technical)" — passed to the model for disambiguation */
  interviewContext: string | null;
  disabled?: boolean;
  /** Set by App when `screen_assessment_result` fires (Ctrl+Alt+S), so results sync when returning from listening mode. */
  hotkeyResult?: AssessmentResult | null;
};

/** Exported for the listening-mode banner in App. */
export function buildAssessmentCopyText(r: AssessmentResult): string {
  const parts = [r.correctAnswer?.trim() ?? ""];
  if (r.briefExplanation?.trim()) {
    parts.push("", r.briefExplanation.trim());
  }
  return parts.filter(Boolean).join("\n");
}

export function UiAnswerPanel({ interviewContext, disabled, hotkeyResult }: UiAnswerPanelProps) {
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [useRegion, setUseRegion] = useState(false);
  const [rx, setRx] = useState("");
  const [ry, setRy] = useState("");
  const [rw, setRw] = useState("");
  const [rh, setRh] = useState("");
  const [editedQuestion, setEditedQuestion] = useState("");

  const ctx = interviewContext?.trim() || undefined;

  const runCaptureAndSolve = useCallback(async () => {
    if (!isTauri() || disabled) return;
    setError("");
    setLoading(true);
    try {
      let region: CaptureRegionPhysical | null = null;
      if (useRegion) {
        const x = parseInt(rx, 10);
        const y = parseInt(ry, 10);
        const width = parseInt(rw, 10);
        const height = parseInt(rh, 10);
        if ([x, y, width, height].some((n) => Number.isNaN(n)) || width <= 0 || height <= 0) {
          setError("Region must be valid integers: x, y, width, height (physical pixels, width/height > 0).");
          setLoading(false);
          return;
        }
        region = { x, y, width, height };
      }
      const b64 = await capturePrimaryScreenPngBase64(region);
      const out = await solveFromScreenshot(b64, ctx);
      setResult(out);
      setEditedQuestion(out.extractedQuestion ?? "");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [ctx, disabled, rh, rw, rx, ry, useRegion]);

  const runReanalyze = useCallback(async () => {
    if (!isTauri() || disabled) return;
    const t = editedQuestion.trim();
    if (t.length < 3) {
      setError("Question text is too short to re-analyze.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const out = await solveFromQuestionText(t, ctx);
      setResult(out);
      setEditedQuestion(out.extractedQuestion ?? t);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [ctx, disabled, editedQuestion]);

  useEffect(() => {
    if (!hotkeyResult) return;
    setResult(hotkeyResult);
    setEditedQuestion(hotkeyResult.extractedQuestion ?? "");
    setError("");
    setLoading(false);
  }, [hotkeyResult]);

  const copyAnswer = async () => {
    if (!result) return;
    const text = buildAssessmentCopyText(result);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("Could not copy to clipboard.");
    }
  };

  const apiTypeLabel = result ? normalizeQuestionType(String(result.questionType)) : "unknown";
  const heuristicLabel = classifyQuestionText(editedQuestion || result?.extractedQuestion || "");

  if (!isTauri()) {
    return (
      <div className="practice-card assessment-panel">
        <h2>Screen assessment assist</h2>
        <p className="subtitle">Run the desktop app (Tauri) to capture the screen and analyze questions.</p>
      </div>
    );
  }

  return (
    <div className="practice-card assessment-panel">
      <h2>Screen assessment assist</h2>
      <p className="subtitle">
        Screenshot-only (no keylogging). Uses OS screen capture + vision LLM. Grant screen-recording permission when the OS
        prompts.
      </p>
      <p className="audio-tip">
        <strong>Ctrl+Alt+S</strong> — capture full screen, analyze, show result here.{" "}
        <strong>Ctrl+Alt+A</strong> — focus this window (same as before).
      </p>

      <label className="screen-share-toggle">
        <input type="checkbox" checked={useRegion} onChange={(e) => setUseRegion(e.target.checked)} disabled={disabled} />
        <span>Custom region (physical pixels — multiply logical px by monitor scale)</span>
      </label>
      {useRegion && (
        <div className="assessment-region-grid">
          <input className="input" type="number" placeholder="x" value={rx} onChange={(e) => setRx(e.target.value)} disabled={disabled} />
          <input className="input" type="number" placeholder="y" value={ry} onChange={(e) => setRy(e.target.value)} disabled={disabled} />
          <input className="input" type="number" placeholder="width" value={rw} onChange={(e) => setRw(e.target.value)} disabled={disabled} />
          <input className="input" type="number" placeholder="height" value={rh} onChange={(e) => setRh(e.target.value)} disabled={disabled} />
        </div>
      )}

      <div className="assessment-actions">
        <button type="button" className="btn btn-primary" onClick={runCaptureAndSolve} disabled={disabled || loading}>
          {loading ? "Working…" : "Capture & solve"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          title="Use primary window scale factor × logical coordinates"
          onClick={async () => {
            try {
              const sf = await getCurrentWindow().scaleFactor();
              setUseRegion(true);
              setRx(String(Math.round(100 * sf)));
              setRy(String(Math.round(100 * sf)));
              setRw(String(Math.round(800 * sf)));
              setRh(String(Math.round(600 * sf)));
            } catch {
              setError("Could not read scale factor.");
            }
          }}
          disabled={disabled}
        >
          Fill example region
        </button>
      </div>

      {error && (
        <div className="error-box" style={{ marginTop: "0.75rem" }}>
          ⚠️ {error}
        </div>
      )}

      {result && (
        <div className="assessment-results">
          <div className="assessment-field">
            <span className="assessment-label">Detected type (API)</span>
            <code className="assessment-code">{apiTypeLabel}</code>
            <span className="assessment-hint">Heuristic from text: {heuristicLabel}</span>
          </div>
          <div className="assessment-field">
            <span className="assessment-label">Extracted question</span>
            <textarea
              className="input assessment-textarea"
              rows={6}
              value={editedQuestion}
              onChange={(e) => setEditedQuestion(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="assessment-field">
            <span className="assessment-label">Answer</span>
            <pre className="assessment-answer">{result.correctAnswer}</pre>
          </div>
          {result.briefExplanation?.trim() && (
            <div className="assessment-field">
              <span className="assessment-label">Brief explanation</span>
              <p className="assessment-explain">{result.briefExplanation}</p>
            </div>
          )}
          <div className="assessment-actions">
            <button type="button" className="btn btn-primary" onClick={copyAnswer} disabled={!result.correctAnswer}>
              Copy answer
            </button>
            <button type="button" className="btn btn-ghost" onClick={runReanalyze} disabled={disabled || loading}>
              Re-analyze from edited text
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
