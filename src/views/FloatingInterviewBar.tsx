import type { MutableRefObject } from "react";
import ReactMarkdown from "react-markdown";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { buildAssessmentCopyText } from "../components/uiAnswerPanel";
import type { ParakeetMenuItem } from "../components/ParakeetMenuDropdown";
import { ParakeetMenuDropdown } from "../components/ParakeetMenuDropdown";
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
  conversationHistory: { question: string; answer: string }[];
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
    conversationHistory,
    typeQuestionInput,
    setTypeQuestionInput,
    submitTranscript,
    memorySavedMessage,
  } = props;

  return (
    <main className="main main-floating-nav">
      <div className="fn-stack">
        <div className="fn-toolbar fn-pill" data-tauri-drag-region>
          <button
            type="button"
            className="fn-soundwave"
            title="Show or hide transcription strip"
            aria-label="Toggle transcription"
            aria-pressed={floatingTranscriptOpen}
            onClick={() => setFloatingTranscriptOpen((v) => !v)}
          >
            <span className="fn-soundwave-icon" aria-hidden />
          </button>
          <button
            type="button"
            className="fn-icon-btn fn-bell-wrap"
            title="Open chat"
            aria-label="Notifications and chat"
            onClick={() => setFloatingChatOpen((v) => !v)}
          >
            🔔
            {(!!suggestion || memorySavedMessage) && <span className="fn-bell-dot" aria-hidden />}
          </button>
          <button
            type="button"
            className={`fn-icon-btn ${isListeningActive ? "fn-mic-on" : ""}`}
            title={isListeningActive ? "Stop listening" : "Start listening"}
            aria-label={isListeningActive ? "Stop listening" : "Start listening"}
            onClick={() => (isListeningActive ? void stopPractice() : void startPractice())}
          >
            🎤
          </button>
          <button
            type="button"
            className="fn-text-btn"
            title="Generate AI answer from heard or typed question"
            onClick={() => void floatingAiAnswer()}
          >
            ✨ AI Answer
          </button>
          <button
            type="button"
            className="fn-text-btn"
            disabled={floatingAnalyzeBusy}
            title="Capture screen and analyze (same as Ctrl+Alt+S)"
            onClick={() => void floatingAnalyzeScreen()}
          >
            {floatingAnalyzeBusy ? "…" : "🖥 Analyze Screen"}
          </button>
          <button
            type="button"
            className="fn-text-btn fn-chat-btn"
            title="Chat and history"
            onClick={() => setFloatingChatOpen((v) => !v)}
          >
            Chat
          </button>
          <span className="fn-timer" title="Session timer">
            ⏱ {sessionStartTimeRef.current > 0 && isListeningActive ? formatMmSs(sessionStartTimeRef.current) : "0:00"}
          </span>
          <div id="pa-menu-anchor-float" className="fn-menu-anchor">
            <button
              type="button"
              className="fn-icon-btn"
              aria-label="Menu"
              title="Menu"
              onClick={(e) => {
                e.stopPropagation();
                setShowPaMenu((v) => !v);
              }}
            >
              ⋮
            </button>
            <ParakeetMenuDropdown open={showPaMenu} items={menuItems} menuClassName="fn-menu-dropdown" />
          </div>
          {isTauri() && (
            <button
              type="button"
              className="fn-icon-btn"
              title="Place window"
              aria-label="Move window"
              onClick={() => setShowPositionPicker(true)}
            >
              ⤢
            </button>
          )}
          <button
            type="button"
            className="fn-icon-btn"
            title="Minimize"
            aria-label="Minimize"
            onClick={() => getCurrentWindow().minimize()}
          >
            ˄
          </button>
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
              <button
                type="button"
                className="fn-icon-btn"
                title="Clear"
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
              <button
                type="button"
                className="fn-icon-btn"
                title={floatingTranscriptExpanded ? "Collapse text" : "Expand text"}
                aria-label="Toggle transcript height"
                onClick={() => setFloatingTranscriptExpanded((e) => !e)}
              >
                ˅
              </button>
              <button
                type="button"
                className="fn-icon-btn"
                title="Exit compact bar — open full assistant"
                aria-label="Close compact bar"
                onClick={() => exitFloatingBarToFullAssistant()}
              >
                ✕
              </button>
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
            <div className="fn-chat-scroll">
              {[...conversationHistory].reverse().map((qa, i) => (
                <div key={`${qa.question.slice(0, 24)}-${i}`} className="fn-chat-item">
                  <div className="fn-chat-q">{qa.question}</div>
                  <div className="fn-chat-a">{qa.answer.length > 400 ? `${qa.answer.slice(0, 400)}…` : qa.answer}</div>
                </div>
              ))}
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
