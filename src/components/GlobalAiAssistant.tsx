import { useEffect, useRef } from "react";
import { Tooltip } from "./Tooltip";
import "./GlobalAiAssistant.css";

export type GlobalAiAssistantProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hide FAB (e.g. compact floating bar or click-through). */
  showFab: boolean;
  contextLabel: string;
  statusLine?: string;
  onAnalyzeScreen: () => void;
  /** Multi-capture while user scrolls (coding pages with long I/O). */
  onAnalyzeScreenDeep?: () => void;
  analyzeBusy: boolean;
  onOpenFullAssistant: () => void;
  onFocusListening?: () => void;
  questionPreview?: string;
  answerPreview?: string;
};

export function GlobalAiAssistant({
  open,
  onOpenChange,
  showFab,
  contextLabel,
  statusLine,
  onAnalyzeScreen,
  onAnalyzeScreenDeep,
  analyzeBusy,
  onOpenFullAssistant,
  onFocusListening,
  questionPreview,
  answerPreview,
}: GlobalAiAssistantProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <>
      {open && (
        <button
          type="button"
          className="gai-backdrop"
          aria-label="Close assistant panel"
          onClick={() => onOpenChange(false)}
        />
      )}
      <aside
        ref={panelRef}
        className={`gai-panel ${open ? "gai-panel-open" : ""}`}
        aria-hidden={!open}
        aria-label="AI Assistant"
      >
        <div className="gai-panel-head">
          <div>
            <h2 className="gai-title">Assistant</h2>
            <p className="gai-context">{contextLabel}</p>
          </div>
          <button type="button" className="gai-icon-close" onClick={() => onOpenChange(false)} aria-label="Close">
            ✕
          </button>
        </div>
        {statusLine ? <p className="gai-status">{statusLine}</p> : null}

        <section className="gai-section" aria-labelledby="gai-actions-heading">
          <h3 id="gai-actions-heading" className="gai-section-title">
            Quick actions
          </h3>
          <div className="gai-actions">
            <button type="button" className="gai-action-btn gai-action-primary" onClick={onOpenFullAssistant}>
              Open full session
            </button>
            <button
              type="button"
              className="gai-action-btn"
              onClick={onAnalyzeScreen}
              disabled={analyzeBusy}
            >
              {analyzeBusy ? "Analyzing…" : "Analyze screen"}
            </button>
            {onAnalyzeScreenDeep ? (
              <button
                type="button"
                className="gai-action-btn"
                onClick={onAnalyzeScreenDeep}
                disabled={analyzeBusy}
                title="Takes 3 screenshots ~3s apart — scroll the problem between shots"
              >
                {analyzeBusy ? "…" : "Full problem (scroll)"}
              </button>
            ) : null}
            {onFocusListening ? (
              <button type="button" className="gai-action-btn" onClick={onFocusListening}>
                Jump to listen / type
              </button>
            ) : null}
          </div>
        </section>

        <section className="gai-section" aria-labelledby="gai-steps-heading">
          <h3 id="gai-steps-heading" className="gai-section-title">
            Steps
          </h3>
          <ol className="gai-steps">
            <li>Create a session with your role and language.</li>
            <li>Start listening or type the interviewer&apos;s question.</li>
            <li>
              Read answers naturally — use <strong>Analyze screen</strong> for what&apos;s visible, or{" "}
              <strong>Full problem (scroll)</strong> for long coding prompts (scroll between captures).
            </li>
            <li>
              Shortcuts: <kbd>Ctrl+Alt+A</kbd> focus app · <kbd>Ctrl+Alt+S</kbd> single screen capture
            </li>
          </ol>
        </section>

        {(questionPreview || answerPreview) && (
          <section className="gai-section gai-preview" aria-labelledby="gai-live-heading">
            <h3 id="gai-live-heading" className="gai-section-title">
              Live snapshot
            </h3>
            {questionPreview ? (
              <p className="gai-preview-block">
                <span className="gai-preview-label">Question</span>
                {questionPreview.length > 220 ? `${questionPreview.slice(0, 220)}…` : questionPreview}
              </p>
            ) : null}
            {answerPreview ? (
              <p className="gai-preview-block">
                <span className="gai-preview-label">Answer</span>
                {answerPreview.length > 280 ? `${answerPreview.slice(0, 280)}…` : answerPreview}
              </p>
            ) : null}
          </section>
        )}
      </aside>

      {showFab && (
        <Tooltip label="AI Assistant">
          <button
            type="button"
            className="gai-fab"
            onClick={() => onOpenChange(!open)}
            aria-expanded={open}
            aria-label={open ? "Close AI assistant" : "Open AI assistant"}
          >
            <span className="gai-fab-icon" aria-hidden>
              ✨
            </span>
          </button>
        </Tooltip>
      )}
    </>
  );
}
