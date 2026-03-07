import { useState, useRef, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition, LogicalSize, primaryMonitor } from "@tauri-apps/api/window";
import ReactMarkdown from "react-markdown";
import { extractTextFromFile } from "./documentParser";
import { canStartSession, formatUsage, type UserUsage } from "./lib/supabase";
import { getStoredToken, clearStoredToken } from "./lib/auth";
import { fetchOrCreateUsage, recordSession } from "./lib/usage";
import { tauriInvoke } from "./lib/tauri";
import { AuthScreen } from "./components/AuthScreen";
import { UpgradeModal } from "./components/UpgradeModal";
import { AdminPanel } from "./components/AdminPanel";
import "./App.css";

const INTERVIEW_POSITION_STORAGE = "parakeet-interview-position";
const INTERVIEW_TYPE_STORAGE = "parakeet-interview-type";
const HIDE_FOR_SCREEN_SHARE_KEY = "parakeet-hide-for-screen-share";

export type SessionUser = { id: string; email?: string; role?: string };

function App() {
  const [isListening, setIsListening] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [interviewPosition, setInterviewPosition] = useState("");
  const [interviewType, setInterviewType] = useState("Technical");
  const [setupComplete, setSetupComplete] = useState(false);
  const [documentText, setDocumentText] = useState("");
  const [documentFileName, setDocumentFileName] = useState("");
  const [showSetupForm, setShowSetupForm] = useState(false);
  const [session, setSession] = useState<{ user: SessionUser } | null>(null);
  const [usage, setUsage] = useState<UserUsage | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showPositionPicker, setShowPositionPicker] = useState(false);
  const [clickThroughMode, setClickThroughMode] = useState(false);
  const [editableQuestion, setEditableQuestion] = useState<string | null>(null);
  const [hideForScreenShare, setHideForScreenShare] = useState(() =>
    localStorage.getItem(HIDE_FOR_SCREEN_SHARE_KEY) === "1"
  );
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptBufferRef = useRef<string>("");
  const stopRequestedRef = useRef<boolean>(false);
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionStartTimeRef = useRef<number>(0);

  // Tauri window: skip taskbar, always on top
  useEffect(() => {
    if (typeof window !== "undefined" && (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      const win = getCurrentWindow();
      win.setSkipTaskbar(true).catch(() => {});
      win.setAlwaysOnTop(true).catch(() => {});
    }
  }, []);

  // When user presses Ctrl+Alt+A, turn off click-through so they can use the app
  useEffect(() => {
    if (!(typeof window !== "undefined" && (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)) return;
    const unlisten = listen("parakeet_activate", () => {
      getCurrentWindow().setIgnoreCursorEvents(false).then(() => setClickThroughMode(false)).catch(() => {});
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const placeWindowAt = async (zone: "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right") => {
    try {
      const monitor = await primaryMonitor();
      const win = getCurrentWindow();
      const scale = monitor?.scaleFactor ?? (await win.scaleFactor());
      const width = 420;
      const height = 520;
      const sw = monitor ? monitor.size.width / scale : 1920;
      const sh = monitor ? monitor.size.height / scale : 1080;
      const x = monitor?.position != null ? monitor.position.x / scale : 0;
      const y = monitor?.position != null ? monitor.position.y / scale : 0;
      const right = x + sw;
      const bottom = y + sh;
      let posX: number, posY: number;
      switch (zone) {
        case "top-left":
          posX = x;
          posY = y;
          break;
        case "top-center":
          posX = x + (sw - width) / 2;
          posY = y;
          break;
        case "top-right":
          posX = right - width;
          posY = y;
          break;
        case "bottom-left":
          posX = x;
          posY = bottom - height;
          break;
        case "bottom-center":
          posX = x + (sw - width) / 2;
          posY = bottom - height;
          break;
        case "bottom-right":
          posX = right - width;
          posY = bottom - height;
          break;
        default:
          return;
      }
      await win.setPosition(new LogicalPosition(Math.round(posX), Math.round(posY)));
      await win.setSize(new LogicalSize(width, height));
      setShowPositionPicker(false);
    } catch (e) {
      console.error("Place window error", e);
      setShowPositionPicker(false);
    }
  };

  // Auth state (local Tauri/SQLite)
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setSession(null);
      setUsage(null);
      return;
    }
    tauriInvoke<SessionUser>("auth_session", { token })
      .then((user) => {
        setSession({ user: { id: user.id, email: user.email, role: user.role } });
        return fetchOrCreateUsage(token);
      })
      .then(setUsage)
      .catch(() => {
        clearStoredToken();
        setSession(null);
        setUsage(null);
      });
  }, []);

  // Load interview setup from localStorage
  useEffect(() => {
    const pos = localStorage.getItem(INTERVIEW_POSITION_STORAGE);
    const type = localStorage.getItem(INTERVIEW_TYPE_STORAGE);
    if (pos) {
      setInterviewPosition(pos);
      setSetupComplete(true);
    }
    if (type) setInterviewType(type);
  }, []);

  const saveSetup = () => {
    const pos = interviewPosition.trim();
    if (!pos) {
      setError("Please enter the position you're interviewing for.");
      return;
    }
    localStorage.setItem(INTERVIEW_POSITION_STORAGE, pos);
    localStorage.setItem(INTERVIEW_TYPE_STORAGE, interviewType);
    setSetupComplete(true);
    setShowSetupForm(false);
    setError("");
  };

  const onDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setStatus("Extracting text from document...");
    try {
      const text = await extractTextFromFile(file);
      setDocumentText(text);
      setDocumentFileName(file.name);
      setStatus("");
    } catch (err) {
      setError(String(err));
      setStatus("");
    }
    e.target.value = "";
  };

  useEffect(() => {
    const unlistenTranscript = listen<string>("transcript", (e) => {
      setQuestion(e.payload);
      setStatus("Generating answer...");
    });

    const unlistenAnswerChunk = listen<string>("answer_chunk", (e) => {
      setSuggestion((prev) => prev + e.payload);
    });

    const unlistenAnswer = listen<{ question: string; answer: string }>(
      "answer",
      (e) => {
        setQuestion(e.payload.question);
        setSuggestion(e.payload.answer);
        setStatus("");
      }
    );

    const unlistenError = listen<string>("backend_error", (e) => {
      setError(e.payload);
      setStatus("");
    });

    const unlistenStatus = listen<string>("status", (e) => {
      setStatus(e.payload);
    });

    return () => {
      unlistenTranscript.then((fn) => fn());
      unlistenAnswerChunk.then((fn) => fn());
      unlistenAnswer.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenStatus.then((fn) => fn());
    };
  }, []);

  const submitTranscript = async (transcript: string) => {
    const trimmed = transcript.trim();
    if (trimmed.length < 3) return;
    setEditableQuestion(null);
    setSuggestion("");
    try {
      setStatus("Generating answer...");
      setQuestion(trimmed);
      const interviewContext = interviewPosition.trim()
        ? `${interviewPosition.trim()} (${interviewType})`
        : null;
      await tauriInvoke("answer_from_transcript", {
        transcript: trimmed,
        interviewContext: interviewContext || undefined,
        documentText: documentText.trim() || undefined,
      });
    } catch (err) {
      setError(String(err));
      setStatus("");
    }
  };

  const startPractice = async () => {
    if (session?.user?.id) {
      const check = canStartSession(usage);
      if (!check.allowed) {
        setError(check.reason ?? "Upgrade to continue");
        setShowUpgrade(true);
        return;
      }
    }

    setError("");
    setSuggestion("");
    setQuestion("");
    transcriptBufferRef.current = "";
    setStatus("Starting...");
    sessionStartTimeRef.current = Date.now();

    const SpeechRecognitionAPI =
      (window as Window).SpeechRecognition || (window as Window).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setError("Speech recognition not supported in this browser. Use Chrome or Edge.");
      return;
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (e: SpeechRecognitionEvent) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            const part = e.results[i][0].transcript;
            if (part) {
              const prev = transcriptBufferRef.current;
              transcriptBufferRef.current = prev ? `${prev} ${part}` : part;
              setQuestion(transcriptBufferRef.current);
            }
          }
        }
      };
      recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
        if (e.error !== "no-speech" && e.error !== "aborted") {
          setError(`Speech error: ${e.error}`);
        }
      };
      recognition.onend = () => {
        if (stopRequestedRef.current) {
          stopRequestedRef.current = false;
          if (fallbackTimeoutRef.current) {
            clearTimeout(fallbackTimeoutRef.current);
            fallbackTimeoutRef.current = null;
          }
          const transcript = transcriptBufferRef.current.trim();
          transcriptBufferRef.current = "";
          if (transcript.length >= 3) submitTranscript(transcript);
        }
      };
      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
      tauriInvoke("set_listening", { listening: true });
      setStatus("Listening... Hear the question, then press Stop to generate answer.");
    } catch (err) {
      setError(`Microphone access denied: ${err}`);
      setStatus("");
    }
  };

  const stopPractice = async () => {
    const startedAt = sessionStartTimeRef.current;
    stopRequestedRef.current = true;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    setIsListening(false);
    tauriInvoke("set_listening", { listening: false });
    setStatus("");
    const token = getStoredToken();
    if (token && session?.user?.id && startedAt > 0) {
      const minutes = (Date.now() - startedAt) / 60000;
      sessionStartTimeRef.current = 0;
      const updated = await recordSession(token, minutes);
      if (updated) setUsage(updated);
    }
    // Fallback: onend may not fire in some browsers (e.g. WebView2)
    fallbackTimeoutRef.current = setTimeout(() => {
      if (stopRequestedRef.current) {
        stopRequestedRef.current = false;
        fallbackTimeoutRef.current = null;
        const transcript = transcriptBufferRef.current.trim();
        transcriptBufferRef.current = "";
        if (transcript.length >= 3) submitTranscript(transcript);
      }
    }, 500);
  };

  const refreshSession = () => {
    const token = getStoredToken();
    if (!token) return;
    tauriInvoke<SessionUser>("auth_session", { token })
      .then((user) => {
        setSession({ user: { id: user.id, email: user.email, role: user.role } });
        return fetchOrCreateUsage(token);
      })
      .then(setUsage)
      .catch(() => {
        clearStoredToken();
        setSession(null);
        setUsage(null);
      });
  };

  if (!session) {
    return <AuthScreen onAuth={refreshSession} />;
  }

  const isListeningLayout = setupComplete && !showSetupForm && (isListening || !!question || !!suggestion);

  useEffect(() => {
    if (clickThroughMode) {
      document.body.classList.add("parakeet-click-through");
    } else {
      document.body.classList.remove("parakeet-click-through");
    }
    return () => document.body.classList.remove("parakeet-click-through");
  }, [clickThroughMode]);

  return (
    <div className={`app ${isListeningLayout ? "app-listening" : ""} ${clickThroughMode ? "app-click-through" : ""}`}>
      {showPositionPicker && (
        <div className="position-picker-overlay">
          {(["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"] as const).map((zone) => (
            <button
              key={zone}
              type="button"
              className="position-zone"
              onClick={() => placeWindowAt(zone)}
            >
              {zone.replace("-", " ")}
            </button>
          ))}
        </div>
      )}
      {!isListeningLayout && (
      <header className="header">
        <div className="header-drag-area" data-tauri-drag-region>
          <h1>AI Assistant</h1>
          <p>Your AI Interview Assistant</p>
          {clickThroughMode && (
            <p className="privacy-badge click-through-hint">
              Clicks go to app behind — <strong>Ctrl+Alt+A</strong> to use Parakeet again
            </p>
          )}
          <p className="privacy-badge">
            🔒 Hidden from screen share – never visible to interviewer
          </p>
          <p className="privacy-badge" style={{ marginTop: "0.25rem" }}>
            ⌨️ <strong>Ctrl+Alt+A</strong> – bring window to front from anywhere
          </p>
        </div>
        <div className="header-actions">
          {(typeof window !== "undefined" && !!(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) && (
            <>
              <button
                type="button"
                className={`btn btn-ghost ${clickThroughMode ? "btn-ghost-active" : ""}`}
                onClick={() => {
                  if (clickThroughMode) return;
                  getCurrentWindow().setIgnoreCursorEvents(true).then(() => setClickThroughMode(true)).catch(() => {});
                }}
                title="Click-through: clicks go to app behind. Press Ctrl+Alt+A to use Parakeet again."
              >
                {clickThroughMode ? "✓ Passthrough" : "Click-through"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowPositionPicker(true)} title="Place window on screen">
                📌 Place
              </button>
            </>
          )}
          {session?.user?.email && (
            <span className="signed-in-as" title="You are signed in">
              {session.user.email}
            </span>
          )}
          {usage && (
            <span className="usage-badge" title={formatUsage(usage)}>
              {formatUsage(usage)}
            </span>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => setShowUpgrade(true)}>
            Upgrade
          </button>
          {session?.user?.role === "superadmin" && (
            <button type="button" className="btn btn-ghost" onClick={() => setShowAdmin(true)} title="Admin">
              Admin
            </button>
          )}
          {session && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                const token = getStoredToken();
                if (token) await tauriInvoke("auth_logout", { token }).catch(() => {});
                clearStoredToken();
                setSession(null);
                setUsage(null);
              }}
              title="Sign out"
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      )}

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} onApplied={() => setShowUpgrade(false)} onUsageUpdate={setUsage} />}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}

      {isListeningLayout ? (
        <main className="main main-listening">
          <div className="listening-bar">
            <span className="listening-status" data-tauri-drag-region>
              {isListening ? (status || "Listening...") : suggestion ? "Answer ready" : question ? "Generating answer…" : "Parakeet"}
            </span>
            {isListening ? (
              <button type="button" className="btn btn-danger btn-sm" onClick={stopPractice}>
                Stop Listening
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-primary btn-sm" onClick={startPractice}>
                  Start Listening
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setQuestion("");
                    setSuggestion("");
                    setError("");
                    setEditableQuestion(null);
                  }}
                >
                  Back to setup
                </button>
              </>
            )}
          </div>
          {error && (
            <div className="error-box listening-error">
              ⚠️ {error}
            </div>
          )}
          <div className="listening-center">
            {editableQuestion !== null ? (
              <div className="suggestion-box question-edit-box center-box">
                <h3>Edit question</h3>
                <input
                  type="text"
                  className="input question-edit-input"
                  value={editableQuestion}
                  onChange={(e) => setEditableQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const t = editableQuestion.trim();
                      if (t.length >= 3) submitTranscript(t);
                    }
                  }}
                  placeholder="Fix the question, then press Enter"
                  autoFocus
                />
                <p className="question-edit-hint">Press Enter to get answer</p>
              </div>
            ) : question ? (
              <div className="suggestion-box question-row center-box">
                <div className="question-text-wrap">
                  <h3>Question heard</h3>
                  <p className="question-text">{question}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  onClick={() => setEditableQuestion(question)}
                  title="Edit question"
                  aria-label="Edit question"
                >
                  ✏️
                </button>
              </div>
            ) : null}
            {suggestion && (
              <div className="suggestion-box answer-box center-answer-box">
                <h3>Your answer (read this aloud)</h3>
                <div className="answer-content answer-content-visible">
                  <ReactMarkdown>{suggestion}</ReactMarkdown>
                </div>
              </div>
            )}
            {!question && !suggestion && !error && (
              <p className="listening-placeholder">Ask a question… then press Stop to get your answer.</p>
            )}
          </div>
        </main>
      ) : (
      <main className="main">
        {!setupComplete || showSetupForm ? (
          <div className="practice-card setup-card">
            <h2>Interview setup</h2>
            <p className="subtitle">
              Tell the app what role you’re interviewing for so answers stay on-topic (e.g. “React” = ReactJS, not emotion).
            </p>
            <label className="input-label">Position / role you’re interviewing for *</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. Frontend Developer, React Developer, Data Engineer"
              value={interviewPosition}
              onChange={(e) => setInterviewPosition(e.target.value)}
            />
            <label className="input-label">Interview type</label>
            <select
              className="input"
              value={interviewType}
              onChange={(e) => setInterviewType(e.target.value)}
            >
              <option value="Technical">Technical</option>
              <option value="Behavioral">Behavioral</option>
              <option value="Mixed">Mixed</option>
            </select>
            <div className="modal-actions" style={{ marginTop: "1rem" }}>
              <button className="btn btn-primary" onClick={saveSetup}>
                Save & continue
              </button>
              {setupComplete && (
                <button className="btn btn-ghost" onClick={() => setShowSetupForm(false)}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : null}

        {setupComplete && !showSetupForm && (
        <div className="practice-card">
          {!hideForScreenShare && (
            <div className="setup-summary">
              <span className="setup-badge">Interview: {interviewPosition} ({interviewType})</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSetupForm(true)}>
                Change
              </button>
            </div>
          )}
          <label className="screen-share-toggle">
            <input
              type="checkbox"
              checked={hideForScreenShare}
              onChange={(e) => {
                const v = e.target.checked;
                setHideForScreenShare(v);
                localStorage.setItem(HIDE_FOR_SCREEN_SHARE_KEY, v ? "1" : "0");
              }}
            />
            <span>Hide details for screen share</span>
          </label>
          <p className="audio-tip">
            📄 <strong>Reference document (optional):</strong> Upload a PDF or Word file (resume, talking points). Answers can use this when relevant.
          </p>
          <div className="document-upload">
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={onDocumentUpload}
              id="doc-upload"
              className="file-input"
            />
            <label htmlFor="doc-upload" className="btn btn-ghost">
              {documentFileName ? `✓ ${documentFileName}` : "Upload PDF or Word"}
            </label>
            {documentFileName && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDocumentText(""); setDocumentFileName(""); }}>
                Clear
              </button>
            )}
          </div>

          <h2>Interview Practice</h2>
          <p className="subtitle">
            Works with Zoom, Meet, Teams – listens to questions, gives you answers to read
          </p>
          <p className="audio-tip">
            💡 Use <strong>Stereo Mix</strong> or <strong>What U Hear</strong> as
            your mic in Windows Sound settings to capture meeting audio.
          </p>

          <div className="controls">
            {!isListening ? (
              <button
                className="btn btn-primary"
                onClick={startPractice}
                disabled={!!(session && usage === null)}
                title={session && usage === null ? "Loading..." : undefined}
              >
                {session && usage === null ? "Loading..." : "Start Listening"}
              </button>
            ) : (
              <button className="btn btn-danger" onClick={stopPractice}>
                Stop Listening
              </button>
            )}
          </div>

          {status && (
            <div className="status-box">
              <span className="pulse">●</span> {status}
            </div>
          )}

          {error && (
            <div className="error-box">
              ⚠️ {error}
            </div>
          )}

          {editableQuestion !== null ? (
            <div className="suggestion-box question-edit-box">
              <h3>Edit question</h3>
              <input
                type="text"
                className="input question-edit-input"
                value={editableQuestion}
                onChange={(e) => setEditableQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const t = editableQuestion.trim();
                    if (t.length >= 3) submitTranscript(t);
                  }
                }}
                placeholder="Fix the question, then press Enter"
                autoFocus
              />
              <p className="question-edit-hint">Press Enter to get answer</p>
            </div>
          ) : question ? (
            <div className="suggestion-box question-row">
              <div className="question-text-wrap">
                <h3>Question heard</h3>
                <p className="question-text">{question}</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setEditableQuestion(question)}
                title="Edit question and get answer again"
                aria-label="Edit question"
              >
                ✏️
              </button>
            </div>
          ) : null}

          {suggestion && (
            <div className="suggestion-box answer-box">
              <h3>Your answer (read this aloud)</h3>
              <div className="answer-content">
                <ReactMarkdown>{suggestion}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
        )}
      </main>
      )}
    </div>
  );
}

export default App;
