import type { MutableRefObject } from "react";
import ReactMarkdown from "react-markdown";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { buildAssessmentCopyText } from "../components/uiAnswerPanel";
import type { ParakeetMenuItem } from "../components/ParakeetMenuDropdown";
import { ParakeetMenuDropdown } from "../components/ParakeetMenuDropdown";
import { Tooltip } from "../components/Tooltip";
import { isTauri } from "../lib/tauri";
import type { AssessmentResult } from "../assessment/types";

export type FloatingInterviewBarProps = {
  floatingTranscriptOpen: boolean;
  setFloatingTranscriptOpen: (v: boolean | ((b: boolean) => boolean)) => void;
  floatingChatOpen: boolean;
  setFloatingChatOpen: (v: boolean | ((b: boolean) => boolean)) => void;
  floatingTranscriptExpanded: boolean;
  setFloatingTranscriptExpanded: (v: boolean | ((b: boolean) => boolean)) => void;
  floatingAnalyzeBusy: boolean;
  isListening: boolean;
  startPractice: () => void | Promise<void>;
  stopPractice: () => void | Promise<void>;
  floatingAiAnswer: () => void | Promise<void>;
  floatingAnalyzeScreen: () => void | Promise<void>;
  floatingAnalyzeScreenDeep: () => void | Promise<void>;
  formatMmSs: (startedAt: number) => string;
  sessionStartTimeRef: MutableRefObject<number>;
  showPaMenu: boolean;
  setShowPaMenu: (v: boolean | ((b: boolean) => boolean)) => void;
  menuItems: ParakeetMenuItem[];
  setShowPositionPicker: (v: boolean) => void;
  exitFloatingBarToFullAssistant: () => void;
  question: string;
  suggestion: string;
  status: string;
  error: string;
  setQuestion: (v: string) => void;
  setSuggestion: (v: string) => void;
  setError: (v: string) => void;
  setStatus: (v: string) => void;
  transcriptBufferRef: MutableRefObject<string>;
  screenAssessmentHotkey: AssessmentResult | null;
  setScreenAssessmentHotkey: (v: AssessmentResult | null) => void;
  typeQuestionInput: string;
  setTypeQuestionInput: (v: string) => void;
  submitTranscript: (t: string) => void | Promise<void>;
  memorySavedMessage: boolean;
};

export function FloatingInterviewBar(props: FloatingInterviewBarProps) {
  const {
    floatingTranscriptOpen,
    setFloatingTranscriptOpen,
    floatingChatOpen,
    setFloatingChatOpen,
    floatingTranscriptExpanded,
    setFloatingTranscriptExpanded,
    floatingAnalyzeBusy,
    startPractice,
    stopPractice,
    floatingAiAnswer,
    floatingAnalyzeScreen,
    floatingAnalyzeScreenDeep,
    formatMmSs,
    sessionStartTimeRef,
    showPaMenu,
    setShowPaMenu,
    menuItems,
    setShowPositionPicker,
    exitFloatingBarToFullAssistant,
    isListening: isListeningActive,
    question,
    suggestion,
    status,
    error,
    setQuestion,
    setSuggestion,
    setError,
    setStatus,
    transcriptBufferRef,
    screenAssessmentHotkey,
    setScreenAssessmentHotkey,
    typeQuestionInput,
    setTypeQuestionInput,
    submitTranscript,
    memorySavedMessage,
  } = props;

  return (
    <main className="main main-floating-nav">
      <div className="fn-stack">
        <div className="fn-toolbar fn-pill" data-tauri-drag-region>
          <Tooltip label="Show or hide transcription strip">
            <button
              type="button"
              className="fn-soundwave"
              aria-label="Toggle transcription"
              aria-pressed={floatingTranscriptOpen}
              onClick={() => setFloatingTranscriptOpen((v) => !v)}
            >
              <span className="fn-soundwave-icon" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label="Open chat">
            <button
              type="button"
              className="fn-icon-btn fn-bell-wrap"
              aria-label="Notifications and chat"
              onClick={() => setFloatingChatOpen((v) => !v)}
            >
              🔔
              {(!!suggestion || memorySavedMessage) && <span className="fn-bell-dot" aria-hidden />}
            </button>
          </Tooltip>
          <Tooltip label={isListeningActive ? "Stop listening" : "Start listening"}>
            <button
              type="button"
              className={`fn-icon-btn ${isListeningActive ? "fn-mic-on" : ""}`}
              aria-label={isListeningActive ? "Stop listening" : "Start listening"}
              onClick={() => (isListeningActive ? void stopPractice() : void startPractice())}
            >
              🎤
            </button>
          </Tooltip>
          <Tooltip label="Generate AI answer from heard or typed question">
            <button type="button" className="fn-text-btn" onClick={() => void floatingAiAnswer()}>
              ✨ AI Answer
            </button>
          </Tooltip>
          <Tooltip label="Single full-screen capture (Ctrl+Alt+S)">
            <button
              type="button"
              className="fn-text-btn"
              disabled={floatingAnalyzeBusy}
              onClick={() => void floatingAnalyzeScreen()}
            >
              {floatingAnalyzeBusy ? "…" : "🖥 Screen"}
            </button>
          </Tooltip>
          <Tooltip label="3 captures ~3s apart — scroll the coding problem so I/O and constraints are included">
            <button
              type="button"
              className="fn-text-btn"
              disabled={floatingAnalyzeBusy}
              onClick={() => void floatingAnalyzeScreenDeep()}
            >
              {floatingAnalyzeBusy ? "…" : "📜 Full problem"}
            </button>
          </Tooltip>
          <Tooltip label="Chat and history">
            <button type="button" className="fn-text-btn fn-chat-btn" onClick={() => setFloatingChatOpen((v) => !v)}>
              Chat
            </button>
          </Tooltip>
          <Tooltip label="Session timer">
            <span className="fn-timer">
              ⏱ {sessionStartTimeRef.current > 0 && isListeningActive ? formatMmSs(sessionStartTimeRef.current) : "0:00"}
            </span>
          </Tooltip>
          <div id="pa-menu-anchor-float" className="fn-menu-anchor">
            <Tooltip label="Menu">
              <button
                type="button"
                className="fn-icon-btn"
                aria-label="Menu"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowPaMenu((v) => !v);
                }}
              >
                ⋮
              </button>
            </Tooltip>
            <ParakeetMenuDropdown open={showPaMenu} items={menuItems} menuClassName="fn-menu-dropdown" />
          </div>
          {isTauri() && (
            <Tooltip label="Place window">
              <button
                type="button"
                className="fn-icon-btn"
                aria-label="Move window"
                onClick={() => setShowPositionPicker(true)}
              >
                ⤢
              </button>
            </Tooltip>
          )}
          <Tooltip label="Minimize">
            <button
              type="button"
              className="fn-icon-btn"
              aria-label="Minimize"
              onClick={() => getCurrentWindow().minimize()}
            >
              ˄
            </button>
          </Tooltip>
        </div>

        {floatingTranscriptOpen && (
          <div className="fn-transcript fn-pill">
            <p className={`fn-transcript-text ${floatingTranscriptExpanded ? "fn-transcript-expanded" : ""}`}>
              {isListeningActive
                ? question || status || "Listening…"
                : question
                  ? question
                  : suggestion
                    ? suggestion.slice(0, 500) + (suggestion.length > 500 ? "…" : "")
                    : status ||
                      "Click the soundwave icon to show or hide transcription of what ParakeetAI is hearing."}
            </p>
            <div className="fn-transcript-actions">
              <Tooltip label="Clear">
                <button
                  type="button"
                  className="fn-icon-btn"
                  aria-label="Clear transcript"
                  onClick={() => {
                    setQuestion("");
                    setSuggestion("");
                    setError("");
                    setStatus("");
                    transcriptBufferRef.current = "";
                    setScreenAssessmentHotkey(null);
                  }}
                >
                  🗑
                </button>
              </Tooltip>
              <Tooltip label={floatingTranscriptExpanded ? "Collapse text" : "Expand text"}>
                <button
                  type="button"
                  className="fn-icon-btn"
                  aria-label="Toggle transcript height"
                  onClick={() => setFloatingTranscriptExpanded((e) => !e)}
                >
                  ˅
                </button>
              </Tooltip>
              <Tooltip label="Exit compact bar — open full assistant">
                <button
                  type="button"
                  className="fn-icon-btn"
                  aria-label="Close compact bar"
                  onClick={() => exitFloatingBarToFullAssistant()}
                >
                  ✕
                </button>
              </Tooltip>
            </div>
          </div>
        )}

        {screenAssessmentHotkey && (
          <div className="fn-assessment fn-pill">
            <div className="fn-assessment-head">
              <strong>Screen capture</strong>
              <span className="fn-assessment-type">{String(screenAssessmentHotkey.questionType || "unknown")}</span>
            </div>
            <pre className="fn-assessment-answer">{screenAssessmentHotkey.correctAnswer}</pre>
            <div className="fn-assessment-actions">
              <button
                type="button"
                className="fn-mini-btn fn-mini-primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(buildAssessmentCopyText(screenAssessmentHotkey));
                  } catch {
                    setError("Could not copy to clipboard.");
                  }
                }}
              >
                Copy
              </button>
              <button type="button" className="fn-mini-btn" onClick={() => setScreenAssessmentHotkey(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {floatingChatOpen && (
          <div className="fn-chat fn-pill">
            <div className="fn-chat-scroll scrollbar-none">
              <p className="fn-chat-hint">
                Showing this question only. Your last answer stays in memory for follow-ups like &quot;explain that&quot;.
              </p>
              {question ? (
                <div className="fn-chat-item fn-chat-current">
                  <div className="fn-chat-label">Current</div>
                  <div className="fn-chat-q">{question}</div>
                  {suggestion ? (
                    <div className="fn-chat-a fn-chat-md">
                      <ReactMarkdown>{suggestion}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="fn-chat-a muted">{status || "…"}</div>
                  )}
                </div>
              ) : null}
            </div>
            <div className="fn-chat-input-row">
              <input
                type="text"
                className="fn-chat-input"
                value={typeQuestionInput}
                onChange={(e) => setTypeQuestionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const t = typeQuestionInput.trim();
                    if (t.length >= 3) {
                      void submitTranscript(t);
                      setTypeQuestionInput("");
                    }
                  }
                }}
                placeholder="Type a question…"
              />
              <button
                type="button"
                className="fn-mini-btn fn-mini-primary"
                onClick={() => {
                  const t = typeQuestionInput.trim();
                  if (t.length >= 3) {
                    void submitTranscript(t);
                    setTypeQuestionInput("");
                  }
                }}
              >
                Send
              </button>
            </div>
          </div>
        )}

        {error && <div className="fn-error fn-pill">⚠️ {error}</div>}
      </div>
    </main>
  );
}
