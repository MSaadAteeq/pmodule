import { useState, useRef, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition, LogicalSize, primaryMonitor } from "@tauri-apps/api/window";
import ReactMarkdown from "react-markdown";
import { extractTextFromFile } from "./documentParser";
import { canStartSession, formatUsage, type UserUsage } from "./lib/supabase";
import { getStoredToken, clearStoredToken } from "./lib/auth";
import { fetchOrCreateUsage, recordSession } from "./lib/usage";
import { tauriInvoke, isTauri } from "./lib/tauri";
import { AuthScreen } from "./components/AuthScreen";
import { UpgradeModal } from "./components/UpgradeModal";
import { AdminPanel } from "./components/AdminPanel";
import { CloudModal } from "./components/CloudModal";
import { UiAnswerPanel, buildAssessmentCopyText } from "./components/uiAnswerPanel";
import { PaSwitch } from "./components/PaSwitch";
import { ParakeetMenuDropdown } from "./components/ParakeetMenuDropdown";
import {
  assistantParakeetMenuItems,
  floatingParakeetMenuItems,
  homeParakeetMenuItems,
} from "./components/parakeetMenuItems";
import { GlobalAiAssistant } from "./components/GlobalAiAssistant";
import { HomeView } from "./views/HomeView";
import { FloatingInterviewBar } from "./views/FloatingInterviewBar";
import { capturePrimaryScreenPngBase64 } from "./assessment/screenCapture";
import { solveFromScreenshot } from "./assessment/answerGenerator";
import type { AssessmentResult } from "./assessment/types";
import "./App.css";

const INTERVIEW_POSITION_STORAGE = "parakeet-interview-position";
const INTERVIEW_TYPE_STORAGE = "parakeet-interview-type";
const HIDE_FOR_SCREEN_SHARE_KEY = "parakeet-hide-for-screen-share";
const SESSION_LANGUAGE_KEY = "parakeet-session-lang";
const SIMPLE_LANGUAGE_KEY = "parakeet-simple-lang";
const SESSION_INSTRUCTIONS_KEY = "parakeet-session-instructions";
const SAVE_TRANSCRIPT_KEY = "parakeet-save-transcript";
const AUTO_GEN_AI_KEY = "parakeet-auto-gen-ai";
const ASSISTANT_TAB_KEY = "parakeet-assistant-tab";

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
  const [typeQuestionInput, setTypeQuestionInput] = useState("");
  const [conversationHistory, setConversationHistory] = useState<{ question: string; answer: string }[]>([]);
  const [memorySavedMessage, setMemorySavedMessage] = useState(false);
  const [hideForScreenShare, setHideForScreenShare] = useState(() =>
    localStorage.getItem(HIDE_FOR_SCREEN_SHARE_KEY) === "1"
  );
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptBufferRef = useRef<string>("");
  const stopRequestedRef = useRef<boolean>(false);
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionStartTimeRef = useRef<number>(0);
  const showTitleBarControls = isTauri();
  const [showAssistantScreen, setShowAssistantScreen] = useState(false);
  const [showCloudModal, setShowCloudModal] = useState(false);
  /** Latest Ctrl+Alt+S screen assessment (listener in App so it works while listening layout is active). */
  const [screenAssessmentHotkey, setScreenAssessmentHotkey] = useState<AssessmentResult | null>(null);
  const [assistantTab, setAssistantTab] = useState<"create" | "past">(() =>
    localStorage.getItem(ASSISTANT_TAB_KEY) === "past" ? "past" : "create"
  );
  const [sessionLanguage, setSessionLanguage] = useState(
    () => localStorage.getItem(SESSION_LANGUAGE_KEY) || "en-US"
  );
  const [simpleLanguage, setSimpleLanguage] = useState(() => localStorage.getItem(SIMPLE_LANGUAGE_KEY) === "1");
  const [extraSessionInstructions, setExtraSessionInstructions] = useState(
    () => localStorage.getItem(SESSION_INSTRUCTIONS_KEY) || ""
  );
  const [saveTranscriptMemory, setSaveTranscriptMemory] = useState(
    () => localStorage.getItem(SAVE_TRANSCRIPT_KEY) !== "0"
  );
  const [autoGenerateAI, setAutoGenerateAI] = useState(() => localStorage.getItem(AUTO_GEN_AI_KEY) === "1");
  const [showPaMenu, setShowPaMenu] = useState(false);
  /** Compact top pill bar (from home → AI Interview Assistant) after session is created. */
  const [interviewFloatingBar, setInterviewFloatingBar] = useState(false);
  const [floatingTranscriptOpen, setFloatingTranscriptOpen] = useState(true);
  const [floatingChatOpen, setFloatingChatOpen] = useState(false);
  const [floatingTranscriptExpanded, setFloatingTranscriptExpanded] = useState(false);
  const [floatingAnalyzeBusy, setFloatingAnalyzeBusy] = useState(false);
  const [sessionElapsedTick, setSessionElapsedTick] = useState(0);
  const wasCompactBarRef = useRef(false);
  const [globalAiOpen, setGlobalAiOpen] = useState(false);

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

  // Click-through mode: toggle body class (must run every render, before any early return)
  useEffect(() => {
    if (clickThroughMode) {
      document.body.classList.add("parakeet-click-through");
    } else {
      document.body.classList.remove("parakeet-click-through");
    }
    return () => document.body.classList.remove("parakeet-click-through");
  }, [clickThroughMode]);

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
        const saveMem = localStorage.getItem(SAVE_TRANSCRIPT_KEY) !== "0";
        if (saveMem) {
          setConversationHistory((prev) => {
            const next = [...prev, { question: e.payload.question, answer: e.payload.answer }];
            return next.slice(-5);
          });
          setMemorySavedMessage(true);
        }
      }
    );

    const unlistenError = listen<string>("backend_error", (e) => {
      setError(e.payload);
      setStatus("");
    });

    const unlistenStatus = listen<string>("status", (e) => {
      setStatus(e.payload);
    });

    const unlistenScreenAssessment = listen<AssessmentResult>("screen_assessment_result", (e) => {
      setScreenAssessmentHotkey(e.payload);
    });

    return () => {
      unlistenTranscript.then((fn) => fn());
      unlistenAnswerChunk.then((fn) => fn());
      unlistenAnswer.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenStatus.then((fn) => fn());
      unlistenScreenAssessment.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!memorySavedMessage) return;
    const t = setTimeout(() => setMemorySavedMessage(false), 4000);
    return () => clearTimeout(t);
  }, [memorySavedMessage]);

  useEffect(() => {
    localStorage.setItem(SESSION_LANGUAGE_KEY, sessionLanguage);
  }, [sessionLanguage]);
  useEffect(() => {
    localStorage.setItem(SIMPLE_LANGUAGE_KEY, simpleLanguage ? "1" : "0");
  }, [simpleLanguage]);
  useEffect(() => {
    localStorage.setItem(SESSION_INSTRUCTIONS_KEY, extraSessionInstructions);
  }, [extraSessionInstructions]);
  useEffect(() => {
    localStorage.setItem(SAVE_TRANSCRIPT_KEY, saveTranscriptMemory ? "1" : "0");
  }, [saveTranscriptMemory]);
  useEffect(() => {
    localStorage.setItem(AUTO_GEN_AI_KEY, autoGenerateAI ? "1" : "0");
  }, [autoGenerateAI]);
  useEffect(() => {
    localStorage.setItem(ASSISTANT_TAB_KEY, assistantTab);
  }, [assistantTab]);

  useEffect(() => {
    if (!showPaMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const a = document.getElementById("pa-menu-anchor");
      const b = document.getElementById("pa-menu-anchor-float");
      if (a?.contains(t) || b?.contains(t)) return;
      setShowPaMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showPaMenu]);

  const buildInterviewContextForModel = (): string | null => {
    const roleLine = interviewPosition.trim()
      ? `${interviewPosition.trim()} (${interviewType})`
      : "";
    const ctxParts: string[] = [];
    if (roleLine) ctxParts.push(roleLine);
    if (simpleLanguage) ctxParts.push("Use simple, plain language that is easy to follow.");
    if (extraSessionInstructions.trim()) {
      ctxParts.push(`Extra instructions: ${extraSessionInstructions.trim()}`);
    }
    return ctxParts.length > 0 ? ctxParts.join("\n\n") : null;
  };

  const submitTranscript = async (transcript: string) => {
    const trimmed = transcript.trim();
    if (trimmed.length < 3) return;
    setEditableQuestion(null);
    setSuggestion("");
    try {
      setStatus("Generating answer...");
      setQuestion(trimmed);
      const interviewContext = buildInterviewContextForModel();
      await tauriInvoke("answer_from_transcript", {
        transcript: trimmed,
        interviewContext: interviewContext || undefined,
        documentText: documentText.trim() || undefined,
        previousQa:
          saveTranscriptMemory && conversationHistory.length > 0 ? conversationHistory : undefined,
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
      recognition.lang = sessionLanguage || "en-US";
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

  const floatingAnalyzeScreen = async () => {
    if (!isTauri() || floatingAnalyzeBusy) return;
    setFloatingAnalyzeBusy(true);
    setError("");
    setStatus("Analyzing screen...");
    try {
      const b64 = await capturePrimaryScreenPngBase64(null);
      const ctx = buildInterviewContextForModel();
      const out = await solveFromScreenshot(b64, ctx || undefined);
      setScreenAssessmentHotkey(out);
      setFloatingChatOpen(true);
      setStatus("");
    } catch (e) {
      setError(String(e));
      setStatus("");
    } finally {
      setFloatingAnalyzeBusy(false);
    }
  };

  const floatingAiAnswer = async () => {
    setError("");
    if (isListening) {
      await stopPractice();
      return;
    }
    const fromBuffer = transcriptBufferRef.current.trim();
    const fromQuestion = question.trim();
    const fromInput = typeQuestionInput.trim();
    const t = fromBuffer || fromQuestion || fromInput;
    if (t.length >= 3) {
      if (fromInput) setTypeQuestionInput("");
      await submitTranscript(t);
      setFloatingChatOpen(true);
    } else {
      setStatus("Listen or type a question, then tap AI Answer.");
      setTimeout(() => setStatus(""), 4500);
    }
  };

  const exitFloatingBarToFullAssistant = () => {
    setInterviewFloatingBar(false);
  };

  useEffect(() => {
    if (!isListening || sessionStartTimeRef.current <= 0) return;
    const id = setInterval(() => setSessionElapsedTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isListening]);

  const formatMmSs = (startedAt: number) => {
    sessionElapsedTick;
    const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const useCompactFloatingBar =
    interviewFloatingBar && showAssistantScreen && setupComplete && !showSetupForm;

  useEffect(() => {
    if (useCompactFloatingBar) document.body.classList.add("body-floating-bar");
    else document.body.classList.remove("body-floating-bar");
    return () => document.body.classList.remove("body-floating-bar");
  }, [useCompactFloatingBar]);

  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const win = getCurrentWindow();
        if (useCompactFloatingBar) {
          wasCompactBarRef.current = true;
          const monitor = await primaryMonitor();
          const scale = monitor?.scaleFactor ?? (await win.scaleFactor());
          const sw = monitor ? monitor.size.width / scale : 1280;
          const sh = monitor ? monitor.size.height / scale : 800;
          const x0 = monitor?.position != null ? monitor.position.x / scale : 0;
          const y0 = monitor?.position != null ? monitor.position.y / scale : 0;
          const width = Math.min(920, Math.max(520, sw - 40));
          let height = 58;
          height += floatingTranscriptOpen ? (floatingTranscriptExpanded ? 120 : 52) : 0;
          if (screenAssessmentHotkey) height += 100;
          if (floatingChatOpen) height += Math.min(280, Math.floor(sh * 0.42));
          if (error) height += 48;
          height = Math.min(height + 32, sh - 20);
          await win.setSize(new LogicalSize(Math.round(width), Math.round(height)));
          await win.setPosition(
            new LogicalPosition(Math.round(x0 + (sw - width) / 2), Math.round(y0 + 10))
          );
        } else if (wasCompactBarRef.current) {
          wasCompactBarRef.current = false;
          if (showAssistantScreen) {
            await win.setSize(new LogicalSize(420, 520));
          } else {
            await win.setSize(new LogicalSize(560, 680));
          }
        }
      } catch {
        /* ignore */
      }
    })();
  }, [
    useCompactFloatingBar,
    showAssistantScreen,
    floatingTranscriptOpen,
    floatingTranscriptExpanded,
    floatingChatOpen,
    screenAssessmentHotkey,
    error,
  ]);

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

  const sessionStatCount = Math.max(
    conversationHistory.length,
    Math.round(usage?.sessions_used ?? 0)
  );

  if (!session) {
    return (
      <div className="app">
        <header className="title-bar title-bar-pa">
          <div className="title-bar-left" data-tauri-drag-region>
            <span className="pa-logo" aria-hidden>
              🦜
            </span>
            <span className="pa-brand-text">ParakeetAI</span>
          </div>
          {showTitleBarControls && (
            <div className="title-bar-controls">
              <button
                type="button"
                className="title-bar-btn title-bar-minimize"
                onClick={() => getCurrentWindow().minimize()}
                title="Minimize"
                aria-label="Minimize"
              />
              <button
                type="button"
                className="title-bar-btn title-bar-maximize"
                onClick={() => getCurrentWindow().toggleMaximize()}
                title="Maximize"
                aria-label="Maximize"
              />
              <button
                type="button"
                className="title-bar-btn title-bar-close"
                onClick={() => getCurrentWindow().close()}
                title="Close"
                aria-label="Close"
              />
            </div>
          )}
        </header>
        <AuthScreen onAuth={refreshSession} />
      </div>
    );
  }

  const isListeningLayout =
    !useCompactFloatingBar &&
    setupComplete &&
    !showSetupForm &&
    (isListening || !!question || !!suggestion);

  /* Home view after login: section "AI Interview Assistant" → opens practice screen */
  if (!showAssistantScreen) {
    return (
      <div className="app">
        <header className="title-bar title-bar-pa">
          <div className="title-bar-left" data-tauri-drag-region>
            <span className="pa-logo" aria-hidden>
              🦜
            </span>
            <span className="pa-brand-text">ParakeetAI</span>
          </div>
          {showTitleBarControls && (
            <>
              <button
                type="button"
                className="pa-stat-pill"
                onClick={() => {
                  setShowAssistantScreen(true);
                  setAssistantTab("past");
                  setInterviewFloatingBar(false);
                }}
                title="Past sessions"
              >
                🔗 {sessionStatCount}
              </button>
              <div className="title-bar-controls">
                <div id="pa-menu-anchor" style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="title-bar-btn"
                    aria-label="Menu"
                    title="Menu"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowPaMenu((v) => !v);
                    }}
                  >
                    ⋮
                  </button>
                  <ParakeetMenuDropdown
                    open={showPaMenu}
                    items={homeParakeetMenuItems({
                      closeMenu: () => setShowPaMenu(false),
                      tauri: isTauri(),
                      clickThroughMode,
                      isSuperAdmin: session?.user?.role === "superadmin",
                      onOpenSession: () => {
                        setShowAssistantScreen(true);
                        setInterviewFloatingBar(false);
                      },
                      onClickThrough: () => {
                        if (clickThroughMode) return;
                        getCurrentWindow()
                          .setIgnoreCursorEvents(true)
                          .then(() => setClickThroughMode(true))
                          .catch(() => {});
                      },
                      onPlaceWindow: () => setShowPositionPicker(true),
                      onUpgrade: () => setShowUpgrade(true),
                      onCloud: () => setShowCloudModal(true),
                      onAdmin: () => setShowAdmin(true),
                      onSignOut: async () => {
                        const token = getStoredToken();
                        if (token) await tauriInvoke("auth_logout", { token }).catch(() => {});
                        clearStoredToken();
                        setSession(null);
                        setUsage(null);
                      },
                    })}
                  />
                </div>
                {isTauri() && (
                  <button
                    type="button"
                    className="title-bar-btn title-bar-move"
                    onClick={() => setShowPositionPicker(true)}
                    title="Place window"
                    aria-label="Move window"
                  />
                )}
                <button
                  type="button"
                  className="title-bar-btn title-bar-minimize"
                  onClick={() => getCurrentWindow().minimize()}
                  title="Minimize"
                  aria-label="Minimize"
                />
                <button
                  type="button"
                  className="title-bar-btn title-bar-maximize"
                  onClick={() => getCurrentWindow().toggleMaximize()}
                  title="Maximize"
                  aria-label="Maximize"
                />
                <button
                  type="button"
                  className="title-bar-btn title-bar-close"
                  onClick={() => getCurrentWindow().close()}
                  title="Close"
                  aria-label="Close"
                />
              </div>
            </>
          )}
        </header>
        <HomeView
          email={session?.user?.email}
          onOpenInterviewFloating={() => {
            setShowAssistantScreen(true);
            setInterviewFloatingBar(true);
          }}
          onOpenAssistantFull={() => {
            setShowAssistantScreen(true);
            setInterviewFloatingBar(false);
          }}
        />
        <GlobalAiAssistant
          open={globalAiOpen}
          onOpenChange={setGlobalAiOpen}
          showFab={!clickThroughMode}
          contextLabel="Home"
          statusLine={status || undefined}
          onAnalyzeScreen={() => void floatingAnalyzeScreen()}
          analyzeBusy={floatingAnalyzeBusy}
          onOpenFullAssistant={() => {
            setShowAssistantScreen(true);
            setInterviewFloatingBar(false);
            setGlobalAiOpen(false);
          }}
          questionPreview={question || undefined}
          answerPreview={suggestion || undefined}
        />
      </div>
    );
  }

  const assistantMenuItems = assistantParakeetMenuItems({
    closeMenu: () => setShowPaMenu(false),
    tauri: isTauri(),
    clickThroughMode,
    isSuperAdmin: session?.user?.role === "superadmin",
    onHome: () => {
      setShowAssistantScreen(false);
      setInterviewFloatingBar(false);
    },
    onClickThrough: () => {
      if (clickThroughMode) return;
      getCurrentWindow()
        .setIgnoreCursorEvents(true)
        .then(() => setClickThroughMode(true))
        .catch(() => {});
    },
    onPlaceWindow: () => setShowPositionPicker(true),
    onUpgrade: () => setShowUpgrade(true),
    onCloud: () => setShowCloudModal(true),
    onAdmin: () => setShowAdmin(true),
    onSignOut: async () => {
      const token = getStoredToken();
      if (token) await tauriInvoke("auth_logout", { token }).catch(() => {});
      clearStoredToken();
      setSession(null);
      setUsage(null);
    },
  });

  const floatingMenuItems = floatingParakeetMenuItems({
    closeMenu: () => setShowPaMenu(false),
    tauri: isTauri(),
    clickThroughMode,
    isSuperAdmin: session?.user?.role === "superadmin",
    onFullWindow: () => exitFloatingBarToFullAssistant(),
    onHome: () => {
      setShowAssistantScreen(false);
      setInterviewFloatingBar(false);
    },
    onClickThrough: () => {
      if (clickThroughMode) return;
      getCurrentWindow()
        .setIgnoreCursorEvents(true)
        .then(() => setClickThroughMode(true))
        .catch(() => {});
    },
    onPlaceWindow: () => setShowPositionPicker(true),
    onUpgrade: () => setShowUpgrade(true),
    onCloud: () => setShowCloudModal(true),
    onAdmin: () => setShowAdmin(true),
    onSignOut: async () => {
      const token = getStoredToken();
      if (token) await tauriInvoke("auth_logout", { token }).catch(() => {});
      clearStoredToken();
      setSession(null);
      setUsage(null);
    },
  });

  const globalAiContextLabel = useCompactFloatingBar
    ? "Compact session bar"
    : isListeningLayout
      ? "Live listening"
      : "Assistant";

  return (
    <div
      className={`app ${useCompactFloatingBar ? "app-floating-bar" : ""} ${isListeningLayout ? "app-listening" : ""} ${clickThroughMode ? "app-click-through" : ""}`}
    >
      {useCompactFloatingBar ? (
        <FloatingInterviewBar
          floatingTranscriptOpen={floatingTranscriptOpen}
          setFloatingTranscriptOpen={setFloatingTranscriptOpen}
          floatingChatOpen={floatingChatOpen}
          setFloatingChatOpen={setFloatingChatOpen}
          floatingTranscriptExpanded={floatingTranscriptExpanded}
          setFloatingTranscriptExpanded={setFloatingTranscriptExpanded}
          floatingAnalyzeBusy={floatingAnalyzeBusy}
          isListening={isListening}
          startPractice={startPractice}
          stopPractice={stopPractice}
          floatingAiAnswer={floatingAiAnswer}
          floatingAnalyzeScreen={floatingAnalyzeScreen}
          formatMmSs={formatMmSs}
          sessionStartTimeRef={sessionStartTimeRef}
          showPaMenu={showPaMenu}
          setShowPaMenu={setShowPaMenu}
          menuItems={floatingMenuItems}
          setShowPositionPicker={setShowPositionPicker}
          exitFloatingBarToFullAssistant={exitFloatingBarToFullAssistant}
          question={question}
          suggestion={suggestion}
          status={status}
          error={error}
          setQuestion={setQuestion}
          setSuggestion={setSuggestion}
          setError={setError}
          setStatus={setStatus}
          transcriptBufferRef={transcriptBufferRef}
          screenAssessmentHotkey={screenAssessmentHotkey}
          setScreenAssessmentHotkey={setScreenAssessmentHotkey}
          conversationHistory={conversationHistory}
          typeQuestionInput={typeQuestionInput}
          setTypeQuestionInput={setTypeQuestionInput}
          submitTranscript={submitTranscript}
          memorySavedMessage={memorySavedMessage}
        />
      ) : (
        <>
      <header className="title-bar title-bar-pa">
        <div className="title-bar-left" data-tauri-drag-region>
          <span className="pa-logo" aria-hidden>
            🦜
          </span>
          <span className="pa-brand-text">ParakeetAI</span>
        </div>
        {showTitleBarControls && (
          <>
            <button
              type="button"
              className="pa-stat-pill"
              onClick={() => setAssistantTab("past")}
              title="Past sessions"
            >
              🔗 {sessionStatCount}
            </button>
            <div className="title-bar-controls">
              <div id="pa-menu-anchor" style={{ position: "relative" }}>
                <button
                  type="button"
                  className="title-bar-btn"
                  aria-label="Menu"
                  title="Menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPaMenu((v) => !v);
                  }}
                >
                  ⋮
                </button>
                <ParakeetMenuDropdown open={showPaMenu} items={assistantMenuItems} />
              </div>
              {isTauri() && (
                <button
                  type="button"
                  className="title-bar-btn title-bar-move"
                  onClick={() => setShowPositionPicker(true)}
                  title="Place window"
                  aria-label="Move window"
                />
              )}
              <button
                type="button"
                className="title-bar-btn title-bar-minimize"
                onClick={() => getCurrentWindow().minimize()}
                title="Minimize"
                aria-label="Minimize"
              />
              <button
                type="button"
                className="title-bar-btn title-bar-maximize"
                onClick={() => getCurrentWindow().toggleMaximize()}
                title="Maximize"
                aria-label="Maximize"
              />
              <button
                type="button"
                className="title-bar-btn title-bar-close"
                onClick={() => getCurrentWindow().close()}
                title="Close"
                aria-label="Close"
              />
            </div>
          </>
        )}
      </header>
      {!isListeningLayout && (
        <div className="pa-hints">
          {clickThroughMode && (
            <p className="privacy-badge click-through-hint">
              Clicks go to app behind — <strong>Ctrl+Alt+A</strong> to use Parakeet again
            </p>
          )}
          <p className="privacy-badge">
            🔒 Hidden from screen share – never visible to interviewer
          </p>
          <p className="privacy-badge">
            ⌨️ <strong>Ctrl+Alt+A</strong> – bring window to front · <strong>Ctrl+Alt+S</strong> – screen capture &amp; solve
          </p>
          {session?.user?.email && (
            <span className="signed-in-as" title="Signed in">
              {session.user.email}
              {usage ? ` · ${formatUsage(usage)}` : ""}
            </span>
          )}
        </div>
      )}

      {isListeningLayout ? (
        <main className="main main-listening">
          <div className="listening-bar">
            <span className="listening-status" data-tauri-drag-region>
              {isListening ? (status || "Listening...") : suggestion ? "Answer ready" : question ? "Generating answer…" : "Parakeet"}
              {isTauri() && (
                <span className="listening-shortcut-hint" title="Screen capture & solve">
                  {" "}
                  · Ctrl+Alt+S
                </span>
              )}
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
                <div className="listening-type-row">
                  <input
                    type="text"
                    className="input listening-type-input"
                    value={typeQuestionInput}
                    onChange={(e) => setTypeQuestionInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const t = typeQuestionInput.trim();
                        if (t.length >= 3) {
                          submitTranscript(t);
                          setTypeQuestionInput("");
                        }
                      }
                    }}
                    placeholder="Or type a question and get AI answer"
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      const t = typeQuestionInput.trim();
                      if (t.length >= 3) {
                        submitTranscript(t);
                        setTypeQuestionInput("");
                      }
                    }}
                    title="Generate answer from typed question"
                  >
                    Get answer
                  </button>
                </div>
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
          {screenAssessmentHotkey && (
            <div className="listening-assessment-banner">
              <div className="listening-assessment-banner-head">
                <strong>Screen capture</strong>
                <span className="listening-assessment-type">
                  {String(screenAssessmentHotkey.questionType || "unknown")}
                </span>
              </div>
              <pre className="listening-assessment-answer">{screenAssessmentHotkey.correctAnswer}</pre>
              <div className="listening-assessment-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(buildAssessmentCopyText(screenAssessmentHotkey));
                    } catch {
                      setError("Could not copy to clipboard.");
                    }
                  }}
                >
                  Copy answer
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setScreenAssessmentHotkey(null)}
                >
                  Dismiss
                </button>
              </div>
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
                {memorySavedMessage && (
                  <p className="memory-saved-badge">Previous question saved to memory — follow-ups can refer to this.</p>
                )}
              </div>
            )}
            {!question && !suggestion && !error && (
              <p className="listening-placeholder">Ask a question… then press Stop to get your answer.</p>
            )}
          </div>
        </main>
      ) : (
      <main className="main pa-main">
        <div className="pa-shell">
          <div className="pa-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={assistantTab === "create"}
              className={`pa-tab ${assistantTab === "create" ? "pa-tab-active" : ""}`}
              onClick={() => setAssistantTab("create")}
            >
              Create
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={assistantTab === "past"}
              className={`pa-tab ${assistantTab === "past" ? "pa-tab-active" : ""}`}
              onClick={() => setAssistantTab("past")}
            >
              Past Sessions
            </button>
          </div>

          {assistantTab === "past" ? (
            <div className="pa-panel">
              {conversationHistory.length === 0 ? (
                <p className="pa-past-empty">
                  No past session Q&amp;A yet. Create a session and ask a question to see it here.
                </p>
              ) : (
                [...conversationHistory].reverse().map((qa, i) => (
                  <div key={`${qa.question.slice(0, 40)}-${i}`} className="pa-past-item">
                    <h4>Question</h4>
                    <p>{qa.question}</p>
                    <h4 style={{ marginTop: "var(--space-3)" }}>Answer</h4>
                    <p>
                      {qa.answer.length > 600 ? `${qa.answer.slice(0, 600)}…` : qa.answer}
                    </p>
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              <div className="pa-panel">
                {showSetupForm && setupComplete && (
                  <p className="audio-tip" style={{ marginTop: 0 }}>
                    Editing session settings — <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSetupForm(false)}>Done</button>
                  </p>
                )}
                <div className="pa-field">
                  <div className="pa-field-header">
                    <span className="pa-field-label">
                      Position / role <span className="pa-info" title="Keeps answers on-topic">i</span>
                    </span>
                  </div>
                  <input
                    type="text"
                    className="input"
                    style={{ marginBottom: 0 }}
                    placeholder="e.g. Frontend Developer, Data Engineer"
                    value={interviewPosition}
                    onChange={(e) => setInterviewPosition(e.target.value)}
                  />
                </div>
                <div className="pa-field">
                  <div className="pa-field-header">
                    <span className="pa-field-label">
                      Interview type <span className="pa-info" title="Technical vs behavioral">i</span>
                    </span>
                  </div>
                  <select
                    className="pa-select"
                    value={interviewType}
                    onChange={(e) => setInterviewType(e.target.value)}
                  >
                    <option value="Technical">Technical</option>
                    <option value="Behavioral">Behavioral</option>
                    <option value="Mixed">Mixed</option>
                  </select>
                </div>
                <div className="pa-field">
                  <div className="pa-field-header">
                    <span className="pa-field-label">
                      Language <span className="pa-info" title="Speech recognition language">i</span>
                    </span>
                  </div>
                  <select
                    className="pa-select"
                    value={sessionLanguage}
                    onChange={(e) => setSessionLanguage(e.target.value)}
                  >
                    <option value="en-US">English</option>
                    <option value="es-ES">Spanish</option>
                    <option value="fr-FR">French</option>
                    <option value="de-DE">German</option>
                    <option value="hi-IN">Hindi</option>
                    <option value="ur-PK">Urdu</option>
                  </select>
                </div>
                <div className="pa-field">
                  <div className="pa-toggle-row">
                    <span className="pa-field-label" style={{ margin: 0 }}>
                      Simple language <span className="pa-info" title="Plain, easy-to-follow answers">i</span>
                    </span>
                    <PaSwitch checked={simpleLanguage} onChange={setSimpleLanguage} />
                  </div>
                </div>
                <div className="pa-field">
                  <div className="pa-field-header">
                    <span className="pa-field-label">
                      Extra context / instructions <span className="pa-info" title="Sent to the model with each answer">i</span>
                    </span>
                  </div>
                  <textarea
                    className="pa-textarea"
                    placeholder="e.g. use a casual tone."
                    value={extraSessionInstructions}
                    onChange={(e) => setExtraSessionInstructions(e.target.value)}
                    rows={4}
                  />
                </div>
                <div className="pa-field">
                  <div className="pa-field-header">
                    <span className="pa-field-label">
                      Resume <span className="pa-info" title="PDF or Word used as context">i</span>
                    </span>
                  </div>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={onDocumentUpload}
                    id="doc-upload"
                    className="file-input"
                  />
                  <div className="pa-resume-row">
                    <div className="pa-resume-icon" aria-hidden>
                      💼
                    </div>
                    <div className="pa-resume-body">
                      <select
                        className="pa-select"
                        value={documentFileName ? "attached" : ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "__upload__") {
                            document.getElementById("doc-upload")?.click();
                          }
                          if (v === "") {
                            setDocumentText("");
                            setDocumentFileName("");
                          }
                        }}
                      >
                        <option value="">No resume attached</option>
                        {documentFileName ? <option value="attached">{documentFileName}</option> : null}
                        <option value="__upload__">Upload PDF or Word…</option>
                      </select>
                      {documentFileName ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          title="Remove resume"
                          onClick={() => {
                            setDocumentText("");
                            setDocumentFileName("");
                          }}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="pa-field">
                  <div className="pa-toggle-row">
                    <div className="pa-toggle-label-wrap">
                      <span className="pa-field-label" style={{ margin: 0 }}>
                        Auto Generate AI Response
                      </span>
                      <span className="pa-badge-new">New</span>
                    </div>
                    <PaSwitch checked={autoGenerateAI} onChange={setAutoGenerateAI} />
                  </div>
                  <p className="audio-tip" style={{ marginTop: "var(--space-2)", marginBottom: 0 }}>
                    Preference is saved. Stop listening still generates answers as before.
                  </p>
                </div>
                <div className="pa-field">
                  <div className="pa-toggle-row">
                    <span className="pa-field-label" style={{ margin: 0 }}>
                      Save Transcript <span className="pa-info" title="Remember Q&amp;A for follow-ups">i</span>
                    </span>
                    <PaSwitch checked={saveTranscriptMemory} onChange={setSaveTranscriptMemory} />
                  </div>
                </div>
                <label className="screen-share-toggle" style={{ marginTop: "var(--space-2)" }}>
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
              </div>

              {setupComplete && !showSetupForm ? (
                <div className="pa-panel pa-session-section">
                  {!hideForScreenShare && (
                    <div className="setup-summary">
                      <span className="setup-badge">
                        Interview: {interviewPosition} ({interviewType})
                      </span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSetupForm(true)}>
                        Edit setup
                      </button>
                    </div>
                  )}
                  <UiAnswerPanel
                    interviewContext={
                      interviewPosition.trim() ? `${interviewPosition.trim()} (${interviewType})` : null
                    }
                    disabled={!canStartSession(usage).allowed}
                    hotkeyResult={screenAssessmentHotkey}
                  />

                  <h2>Live session</h2>
                  <p className="subtitle">
                    Zoom, Meet, Teams — listen or type. Use Stereo Mix on Windows to capture meeting audio.
                  </p>

                  <div className="controls">
                    {!isListening ? (
                      <>
                        <button
                          className="btn btn-primary"
                          onClick={startPractice}
                          disabled={!!(session && usage === null)}
                          title={session && usage === null ? "Loading..." : undefined}
                        >
                          {session && usage === null ? "Loading..." : "Start Listening"}
                        </button>
                        <div className="controls-type-row">
                          <input
                            type="text"
                            className="input controls-type-input"
                            value={typeQuestionInput}
                            onChange={(e) => setTypeQuestionInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const t = typeQuestionInput.trim();
                                if (t.length >= 3) {
                                  submitTranscript(t);
                                  setTypeQuestionInput("");
                                }
                              }
                            }}
                            placeholder="Or type a question and get AI answer"
                          />
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => {
                              const t = typeQuestionInput.trim();
                              if (t.length >= 3) {
                                submitTranscript(t);
                                setTypeQuestionInput("");
                              }
                            }}
                            title="Generate answer from typed question"
                          >
                            Get answer
                          </button>
                        </div>
                      </>
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
                      {memorySavedMessage && (
                        <p className="memory-saved-badge">
                          Previous question saved to memory — follow-ups can refer to this.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : null}

              <div className="pa-footer">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowAssistantScreen(false);
                    setInterviewFloatingBar(false);
                  }}
                >
                  Back
                </button>
                <button type="button" className="btn btn-primary" onClick={saveSetup}>
                  Create Free Session
                </button>
              </div>
            </>
          )}
        </div>
      </main>
      )}
        </>
      )}
      <GlobalAiAssistant
        open={globalAiOpen}
        onOpenChange={setGlobalAiOpen}
        showFab={!clickThroughMode && !useCompactFloatingBar}
        contextLabel={globalAiContextLabel}
        statusLine={status || undefined}
        onAnalyzeScreen={() => void floatingAnalyzeScreen()}
        analyzeBusy={floatingAnalyzeBusy}
        onOpenFullAssistant={() => {
          exitFloatingBarToFullAssistant();
          setAssistantTab("create");
          setGlobalAiOpen(false);
        }}
        onFocusListening={
          setupComplete && !showSetupForm
            ? () => {
                setAssistantTab("create");
                setShowSetupForm(false);
                setGlobalAiOpen(false);
              }
            : undefined
        }
        questionPreview={question || undefined}
        answerPreview={suggestion || undefined}
      />
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
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} onApplied={() => setShowUpgrade(false)} onUsageUpdate={setUsage} />}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
      {showCloudModal && <CloudModal onClose={() => setShowCloudModal(false)} />}
    </div>
  );
}

export default App;
