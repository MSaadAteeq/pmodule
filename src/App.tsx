import { useState, useRef, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
  primaryMonitor,
} from "@tauri-apps/api/window";
import ReactMarkdown from "react-markdown";
import { extractTextFromFile } from "./documentParser";
import { canStartSession, formatUsage, type UserUsage } from "./lib/supabase";
import { getStoredToken, clearStoredToken } from "./lib/auth";
import { fetchOrCreateUsage, recordSession } from "./lib/usage";
import { tauriInvoke, isTauri } from "./lib/tauri";
import {
  getStoredMicId,
  primeMicrophoneStream,
  refreshAudioInputsWithPermission,
  setStoredMicId,
} from "./lib/microphone";
import { AuthScreen } from "./components/AuthScreen";
import { UpgradeModal } from "./components/UpgradeModal";
import { AdminPanel } from "./components/AdminPanel";
import { CloudModal } from "./components/CloudModal";
import { UiAnswerPanel, buildAssessmentCopyText } from "./components/uiAnswerPanel";
import { PaSwitch } from "./components/PaSwitch";
import { ParakeetMenuDropdown } from "./components/ParakeetMenuDropdown";
import { Tooltip } from "./components/Tooltip";
import {
  assistantParakeetMenuItems,
  floatingParakeetMenuItems,
  homeParakeetMenuItems,
} from "./components/parakeetMenuItems";
import { GlobalAiAssistant } from "./components/GlobalAiAssistant";
import { HomeView } from "./views/HomeView";
import { FloatingInterviewBar } from "./views/FloatingInterviewBar";
import { capturePrimaryScreenPngBase64 } from "./assessment/screenCapture";
import { collectScrollStitchCaptures } from "./assessment/multiScreenCapture";
import { solveFromScreenshot, solveFromScreenshots } from "./assessment/answerGenerator";
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
const RESUME_TEXT_STORAGE_KEY = "parakeet-resume-text-v1";
const RESUME_NAME_STORAGE_KEY = "parakeet-resume-name-v1";
const RESUME_MAX_STORAGE_CHARS = 400_000;
/** No new speech for this long → treat question as complete and send (with Auto Generate on). */
const SPEECH_SILENCE_SUBMIT_MS = 900;
/** After a finalized speech segment with no interim text, submit sooner so answers feel snappy. */
const SPEECH_AFTER_FINAL_MS = 420;

/** Tauri `innerSize()` is physical pixels; `LogicalSize` expects logical (CSS) pixels. */
async function tauriLogicalInnerSize(): Promise<{ width: number; height: number }> {
  const win = getCurrentWindow();
  const [physical, factor] = await Promise.all([win.innerSize(), win.scaleFactor()]);
  const logical = physical.toLogical(factor);
  return { width: logical.width, height: logical.height };
}

/** Web Speech API (Chromium/WebView2) uses a cloud service; `network` = could not reach it. */
function messageForSpeechRecognitionError(code: string): string {
  switch (code) {
    case "network":
      return "Speech recognition could not reach the online service (check internet, VPN, or firewall). You can type the question below instead.";
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone or speech recognition was blocked. Check Windows privacy settings for the microphone.";
    case "audio-capture":
      return "No microphone input. Check that a mic is connected and not used exclusively by another app.";
    default:
      return `Speech error: ${code}`;
  }
}

export type SessionUser = { id: string; email?: string; role?: string };

function App() {
  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(false);
  isListeningRef.current = isListening;
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
  /** Final + interim speech — snapshot when stopping so we submit without waiting for last final. */
  const lastLiveUtteranceRef = useRef<string>("");
  const suppressNextOnEndSubmitRef = useRef(false);
  const autoGenerateAIRef = useRef(true);
  const stopRequestedRef = useRef<boolean>(false);
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** After this ms of no new speech, auto-send question (when Auto Generate is on). */
  const silenceSubmitTimerRef = useRef<number | null>(null);
  const submitAnswerInFlightRef = useRef(false);
  const sessionStartTimeRef = useRef<number>(0);
  const showTitleBarControls = isTauri();
  const [showAssistantScreen, setShowAssistantScreen] = useState(false);
  const [showCloudModal, setShowCloudModal] = useState(false);

  const handleCheckForUpdates = () => {
    void (async () => {
      if (!isTauri()) return;
      try {
        const [{ check }, { relaunch }] = await Promise.all([
          import("@tauri-apps/plugin-updater"),
          import("@tauri-apps/plugin-process"),
        ]);
        const update = await check();
        if (!update) {
          window.alert("You're on the latest version.");
          return;
        }
        const notes =
          typeof (update as { body?: string }).body === "string" && (update as { body: string }).body.trim()
            ? `\n\n${(update as { body: string }).body.trim()}`
            : "";
        const ok = window.confirm(
          `Version ${update.version} is available.${notes}\n\nInstall and restart now?`
        );
        if (!ok) return;
        await update.downloadAndInstall();
        await relaunch();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      }
    })();
  };
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
  const [autoGenerateAI, setAutoGenerateAI] = useState(() => localStorage.getItem(AUTO_GEN_AI_KEY) !== "0");
  autoGenerateAIRef.current = autoGenerateAI;
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

  /** Last completed Q&A — sent as context for follow-ups only (not shown as a long history in-session). */
  const lastExchangeRef = useRef<{ question: string; answer: string } | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicIdState] = useState(() => getStoredMicId());

  const setSelectedMicId = (id: string) => {
    setSelectedMicIdState(id);
    setStoredMicId(id);
  };

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

  useEffect(() => {
    if (!showAssistantScreen) return;
    let cancelled = false;
    refreshAudioInputsWithPermission()
      .then((list) => {
        if (!cancelled) setAudioInputDevices(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showAssistantScreen, interviewFloatingBar]);

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
      try {
        const toStore = text.length > RESUME_MAX_STORAGE_CHARS ? text.slice(0, RESUME_MAX_STORAGE_CHARS) : text;
        localStorage.setItem(RESUME_TEXT_STORAGE_KEY, toStore);
        localStorage.setItem(RESUME_NAME_STORAGE_KEY, file.name);
      } catch {
        /* storage full */
      }
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
        lastExchangeRef.current = { question: e.payload.question, answer: e.payload.answer };
        const saveMem = localStorage.getItem(SAVE_TRANSCRIPT_KEY) !== "0";
        if (saveMem) {
          setConversationHistory((prev) => {
            const next = [...prev, { question: e.payload.question, answer: e.payload.answer }];
            return next.slice(-25);
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
    if (!session) return;
    try {
      const stored = localStorage.getItem(RESUME_TEXT_STORAGE_KEY);
      const name = localStorage.getItem(RESUME_NAME_STORAGE_KEY);
      if (stored) {
        setDocumentText((prev) => prev || stored);
        if (name) setDocumentFileName((prev) => prev || name);
      }
    } catch {
      /* quota or disabled */
    }
  }, [session]);
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
    submitAnswerInFlightRef.current = true;
    setEditableQuestion(null);
    setSuggestion("");
    try {
      setStatus("Generating answer...");
      setQuestion(trimmed);
      const interviewContext = buildInterviewContextForModel();
      const prev =
        lastExchangeRef.current && lastExchangeRef.current.question !== trimmed
          ? [
              {
                question: lastExchangeRef.current.question,
                answer: lastExchangeRef.current.answer,
              },
            ]
          : undefined;
      await tauriInvoke("answer_from_transcript", {
        transcript: trimmed,
        interviewContext: interviewContext || undefined,
        documentText: documentText.trim() || undefined,
        previousQa: prev,
      });
    } catch (err) {
      setError(String(err));
      setStatus("");
    } finally {
      submitAnswerInFlightRef.current = false;
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
    lastLiveUtteranceRef.current = "";
    if (silenceSubmitTimerRef.current != null) {
      clearTimeout(silenceSubmitTimerRef.current);
      silenceSubmitTimerRef.current = null;
    }
    setStatus("Starting...");
    sessionStartTimeRef.current = Date.now();

    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;

    const SpeechRecognitionAPI =
      (window as Window).SpeechRecognition || (window as Window).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setError("Speech recognition not supported in this browser. Use Chrome or Edge.");
      return;
    }

    try {
      const stream = await primeMicrophoneStream(selectedMicId.trim() || null);
      micStreamRef.current = stream;
    } catch {
      try {
        const stream = await primeMicrophoneStream(null);
        micStreamRef.current = stream;
      } catch (e) {
        setError(
          `Microphone: ${e instanceof Error ? e.message : String(e)}. Pick another device below or check Windows sound settings.`
        );
        setStatus("");
        return;
      }
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang = sessionLanguage || "en-US";

      const clearSilenceTimer = () => {
        if (silenceSubmitTimerRef.current != null) {
          clearTimeout(silenceSubmitTimerRef.current);
          silenceSubmitTimerRef.current = null;
        }
      };

      const scheduleSilenceAutoSubmit = (preferQuickAfterFinal: boolean) => {
        if (!autoGenerateAIRef.current) return;
        clearSilenceTimer();
        const delay = preferQuickAfterFinal ? SPEECH_AFTER_FINAL_MS : SPEECH_SILENCE_SUBMIT_MS;
        silenceSubmitTimerRef.current = window.setTimeout(() => {
          silenceSubmitTimerRef.current = null;
          if (!isListeningRef.current || stopRequestedRef.current) return;
          if (submitAnswerInFlightRef.current) return;
          const t = (
            lastLiveUtteranceRef.current.trim() || transcriptBufferRef.current.trim()
          ).trim();
          if (t.length < 3) return;
          lastLiveUtteranceRef.current = "";
          transcriptBufferRef.current = "";
          setFloatingChatOpen(true);
          void submitTranscript(t);
        }, delay);
      };

      recognition.onresult = (e: SpeechRecognitionEvent) => {
        let finalText = "";
        let interimText = "";
        for (let i = 0; i < e.results.length; i++) {
          const part = e.results[i][0]?.transcript ?? "";
          if (e.results[i].isFinal) {
            finalText += part;
          } else {
            interimText += part;
          }
        }
        const ft = finalText.trim();
        const it = interimText.trim();
        const combined = it ? (ft ? `${ft} ${it}` : it) : ft;
        transcriptBufferRef.current = ft;
        lastLiveUtteranceRef.current = combined;
        setQuestion(combined);
        if (combined.trim().length >= 2) {
          const preferQuick = it.length === 0 && ft.length >= 4;
          scheduleSilenceAutoSubmit(preferQuick);
        }
      };
      recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
        if (e.error === "no-speech" || e.error === "aborted") {
          return;
        }
        setError(messageForSpeechRecognitionError(e.error));
      };
      recognition.onend = () => {
        if (stopRequestedRef.current) {
          clearSilenceTimer();
          stopRequestedRef.current = false;
          if (fallbackTimeoutRef.current) {
            clearTimeout(fallbackTimeoutRef.current);
            fallbackTimeoutRef.current = null;
          }
          const transcript = (
            lastLiveUtteranceRef.current.trim() || transcriptBufferRef.current.trim()
          ).trim();
          transcriptBufferRef.current = "";
          lastLiveUtteranceRef.current = "";
          const suppress = suppressNextOnEndSubmitRef.current;
          suppressNextOnEndSubmitRef.current = false;
          if (!suppress && autoGenerateAIRef.current && transcript.length >= 3) {
            void submitTranscript(transcript);
          }
          return;
        }
        /* Web Speech often ends after a pause even with continuous=true — restart so one mic tap keeps listening. */
        if (isListeningRef.current && recognitionRef.current === recognition) {
          window.setTimeout(() => {
            if (!isListeningRef.current || stopRequestedRef.current) return;
            if (recognitionRef.current !== recognition) return;
            try {
              recognition.start();
            } catch {
              /* InvalidStateError: already running */
            }
          }, 120);
        }
      };
      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
      tauriInvoke("set_listening", { listening: true });
      setStatus(
        autoGenerateAI
          ? "Listening… Pause briefly after your question — answer is sent automatically (faster once speech finalizes)."
          : "Listening… Press Stop (or AI Answer) when you finish your question."
      );
    } catch (err) {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      setError(`Could not start listening: ${err}`);
      setStatus("");
    }
  };

  const stopPractice = async () => {
    if (silenceSubmitTimerRef.current != null) {
      clearTimeout(silenceSubmitTimerRef.current);
      silenceSubmitTimerRef.current = null;
    }
    const startedAt = sessionStartTimeRef.current;
    stopRequestedRef.current = true;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
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
        const transcript = (
          lastLiveUtteranceRef.current.trim() || transcriptBufferRef.current.trim()
        ).trim();
        transcriptBufferRef.current = "";
        lastLiveUtteranceRef.current = "";
        const suppress = suppressNextOnEndSubmitRef.current;
        suppressNextOnEndSubmitRef.current = false;
        if (!suppress && autoGenerateAIRef.current && transcript.length >= 3) {
          void submitTranscript(transcript);
        }
      }
    }, 120);
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

  /** Several captures while you scroll — best for long coding prompts (I/O samples, constraints). */
  const floatingAnalyzeScreenDeep = async () => {
    if (!isTauri() || floatingAnalyzeBusy) return;
    setFloatingAnalyzeBusy(true);
    setError("");
    try {
      const ctx = buildInterviewContextForModel();
      const shots = await collectScrollStitchCaptures((msg) => setStatus(msg), null);
      setStatus("Analyzing all captures (vision)…");
      const out = await solveFromScreenshots(shots, ctx || undefined);
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
      const t = (
        lastLiveUtteranceRef.current.trim() ||
        question.trim() ||
        typeQuestionInput.trim() ||
        transcriptBufferRef.current.trim()
      ).trim();
      suppressNextOnEndSubmitRef.current = true;
      await stopPractice();
      if (t.length >= 3) {
        if (typeQuestionInput.trim()) setTypeQuestionInput("");
        await submitTranscript(t);
        setFloatingChatOpen(true);
      } else {
        setStatus("Listen or type a question, then tap AI Answer.");
        setTimeout(() => setStatus(""), 4500);
      }
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
          const monitor = (await currentMonitor()) ?? (await primaryMonitor());
          const scale = monitor?.scaleFactor ?? (await win.scaleFactor());
          const sw = monitor ? monitor.size.width / scale : 1280;
          const x0 = monitor?.position != null ? monitor.position.x / scale : 0;
          const y0 = monitor?.position != null ? monitor.position.y / scale : 0;
          const width = Math.min(920, Math.max(520, sw - 40));
          const curLogical = await tauriLogicalInnerSize();
          const safeH = Math.max(120, Math.round(curLogical.height));
          await win.setSize(new LogicalSize(Math.round(width), safeH));
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
  }, [useCompactFloatingBar, showAssistantScreen]);

  /** Compact bar: window height follows real layout (long answers); width/position still from effect above. */
  useEffect(() => {
    if (!isTauri() || !useCompactFloatingBar) return;
    const main = document.querySelector(".main.main-floating-nav");
    const stack = document.querySelector(".fn-stack");
    if (!main || !stack) return;

    const fitFloatingBarWindow = () => {
      const stackH = Math.max(stack.scrollHeight, stack.getBoundingClientRect().height, 1);
      const ms = getComputedStyle(main);
      const pt = parseFloat(ms.paddingTop) || 0;
      const pb = parseFloat(ms.paddingBottom) || 0;
      const rawH = Math.ceil(stackH + pt + pb + 16);
      const contentH = Number.isFinite(rawH) ? rawH : 120;
      const maxH = Math.floor(window.screen.availHeight * 0.94);
      const minH = 96;
      const h = Math.min(Math.max(minH, contentH), maxH);
      if (!Number.isFinite(h) || h < minH) return;
      void (async () => {
        try {
          const win = getCurrentWindow();
          const { width: lw } = await tauriLogicalInnerSize();
          const w = Math.max(320, Math.round(lw));
          const hh = Math.max(minH, Math.round(h));
          await win.setSize(new LogicalSize(w, hh));
        } catch {
          /* ignore */
        }
      })();
    };

    const ro = new ResizeObserver(() => requestAnimationFrame(fitFloatingBarWindow));
    ro.observe(stack);
    ro.observe(main);

    const timers = [0, 100, 320, 800].map((ms) => window.setTimeout(fitFloatingBarWindow, ms));
    requestAnimationFrame(() => requestAnimationFrame(fitFloatingBarWindow));

    return () => {
      ro.disconnect();
      timers.forEach((t) => clearTimeout(t));
    };
  }, [
    useCompactFloatingBar,
    floatingTranscriptOpen,
    floatingTranscriptExpanded,
    floatingChatOpen,
    screenAssessmentHotkey,
    error,
    suggestion,
    question,
    status,
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

  useEffect(() => {
    if (!isTauri() || useCompactFloatingBar) return;
    if (!suggestion.trim() && !question.trim()) return;
    const app = document.querySelector(".app");
    if (!app) return;

    const fitWindowToContent = () => {
      const titleBar = document.querySelector(".app > .title-bar");
      const tbarH = titleBar instanceof HTMLElement ? titleBar.offsetHeight : 0;
      let scrollH = Math.ceil(
        Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
          app.scrollHeight
        )
      );
      const lm = document.querySelector(".main.main-listening");
      if (lm instanceof HTMLElement) {
        scrollH = Math.max(scrollH, Math.ceil(lm.offsetHeight + tbarH + 20));
      }
      const maxH = Math.floor(window.screen.availHeight * 0.94);
      const minH = 460;
      const pad = 56;
      const h = Math.min(Math.max(minH, scrollH + pad), maxH);
      getCurrentWindow().setSize(new LogicalSize(420, h)).catch(() => {});
    };

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(fitWindowToContent);
    });
    ro.observe(app);
    ro.observe(document.documentElement);
    const listeningMain = document.querySelector(".main.main-listening");
    if (listeningMain) ro.observe(listeningMain);

    const timers = [
      window.setTimeout(fitWindowToContent, 0),
      window.setTimeout(fitWindowToContent, 120),
      window.setTimeout(fitWindowToContent, 450),
      window.setTimeout(fitWindowToContent, 1200),
    ];

    requestAnimationFrame(() => requestAnimationFrame(fitWindowToContent));

    return () => {
      ro.disconnect();
      timers.forEach((t) => clearTimeout(t));
    };
  }, [suggestion, question, useCompactFloatingBar]);

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
              <Tooltip label="Minimize">
                <button
                  type="button"
                  className="title-bar-btn title-bar-minimize"
                  onClick={() => getCurrentWindow().minimize()}
                  aria-label="Minimize"
                />
              </Tooltip>
              <Tooltip label="Maximize">
                <button
                  type="button"
                  className="title-bar-btn title-bar-maximize"
                  onClick={() => getCurrentWindow().toggleMaximize()}
                  aria-label="Maximize"
                />
              </Tooltip>
              <Tooltip label="Close">
                <button
                  type="button"
                  className="title-bar-btn title-bar-close"
                  onClick={() => getCurrentWindow().close()}
                  aria-label="Close"
                />
              </Tooltip>
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
              <Tooltip label="Past sessions">
                <button
                  type="button"
                  className="pa-stat-pill"
                  onClick={() => {
                    setShowAssistantScreen(true);
                    setAssistantTab("past");
                    setInterviewFloatingBar(false);
                  }}
                >
                  🔗 {sessionStatCount}
                </button>
              </Tooltip>
              <div className="title-bar-controls">
                <div id="pa-menu-anchor" style={{ position: "relative" }}>
                  <Tooltip label="Menu">
                    <button
                      type="button"
                      className="title-bar-btn"
                      aria-label="Menu"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPaMenu((v) => !v);
                      }}
                    >
                      ⋮
                    </button>
                  </Tooltip>
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
                      onCheckForUpdates: handleCheckForUpdates,
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
                  <Tooltip label="Place window">
                    <button
                      type="button"
                      className="title-bar-btn title-bar-move"
                      onClick={() => setShowPositionPicker(true)}
                      aria-label="Move window"
                    />
                  </Tooltip>
                )}
                <Tooltip label="Minimize">
                  <button
                    type="button"
                    className="title-bar-btn title-bar-minimize"
                    onClick={() => getCurrentWindow().minimize()}
                    aria-label="Minimize"
                  />
                </Tooltip>
                <Tooltip label="Maximize">
                  <button
                    type="button"
                    className="title-bar-btn title-bar-maximize"
                    onClick={() => getCurrentWindow().toggleMaximize()}
                    aria-label="Maximize"
                  />
                </Tooltip>
                <Tooltip label="Close">
                  <button
                    type="button"
                    className="title-bar-btn title-bar-close"
                    onClick={() => getCurrentWindow().close()}
                    aria-label="Close"
                  />
                </Tooltip>
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
          onAnalyzeScreenDeep={() => void floatingAnalyzeScreenDeep()}
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
    onCheckForUpdates: handleCheckForUpdates,
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
    onCheckForUpdates: handleCheckForUpdates,
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
      className={`app scrollbar-none ${useCompactFloatingBar ? "app-floating-bar" : ""} ${isListeningLayout ? "app-listening" : ""} ${clickThroughMode ? "app-click-through" : ""}`}
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
          floatingAnalyzeScreenDeep={floatingAnalyzeScreenDeep}
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
            <Tooltip label="Past sessions">
              <button type="button" className="pa-stat-pill" onClick={() => setAssistantTab("past")}>
                🔗 {sessionStatCount}
              </button>
            </Tooltip>
            <div className="title-bar-controls">
              <div id="pa-menu-anchor" style={{ position: "relative" }}>
                <Tooltip label="Menu">
                  <button
                    type="button"
                    className="title-bar-btn"
                    aria-label="Menu"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowPaMenu((v) => !v);
                    }}
                  >
                    ⋮
                  </button>
                </Tooltip>
                <ParakeetMenuDropdown open={showPaMenu} items={assistantMenuItems} />
              </div>
              {isTauri() && (
                <Tooltip label="Place window">
                  <button
                    type="button"
                    className="title-bar-btn title-bar-move"
                    onClick={() => setShowPositionPicker(true)}
                    aria-label="Move window"
                  />
                </Tooltip>
              )}
              <Tooltip label="Minimize">
                <button
                  type="button"
                  className="title-bar-btn title-bar-minimize"
                  onClick={() => getCurrentWindow().minimize()}
                  aria-label="Minimize"
                />
              </Tooltip>
              <Tooltip label="Maximize">
                <button
                  type="button"
                  className="title-bar-btn title-bar-maximize"
                  onClick={() => getCurrentWindow().toggleMaximize()}
                  aria-label="Maximize"
                />
              </Tooltip>
              <Tooltip label="Close">
                <button
                  type="button"
                  className="title-bar-btn title-bar-close"
                  onClick={() => getCurrentWindow().close()}
                  aria-label="Close"
                />
              </Tooltip>
            </div>
          </>
        )}
      </header>
      {!isListeningLayout && (
        <div className="pa-hints pa-hints-compact">
          {clickThroughMode && (
            <p className="privacy-badge click-through-hint">
              <strong>Ctrl+Alt+A</strong> — click through off
            </p>
          )}
          <p className="privacy-badge">
            🔒 Screen-share safe · ⌨️ <strong>Ctrl+Alt+A</strong> front · <strong>Ctrl+Alt+S</strong> capture
          </p>
          {session?.user?.email && (
            <Tooltip label="Signed in">
              <span className="signed-in-as">
                {session.user.email}
                {usage ? ` · ${formatUsage(usage)}` : ""}
              </span>
            </Tooltip>
          )}
        </div>
      )}

      {isListeningLayout ? (
        <main className="main main-listening">
          <div className="listening-bar">
            <span className="listening-status" data-tauri-drag-region>
              {isListening ? (status || "Listening...") : suggestion ? "Answer ready" : question ? "Generating answer…" : "Parakeet"}
              {isTauri() && (
                <Tooltip label="Screen capture & solve">
                  <span className="listening-shortcut-hint">
                    {" "}
                    · Ctrl+Alt+S
                  </span>
                </Tooltip>
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
                  <Tooltip label="Generate answer from typed question">
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
                    >
                      Get answer
                    </button>
                  </Tooltip>
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
          <div className="listening-center scrollbar-none">
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
                <Tooltip label="Edit question">
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    onClick={() => setEditableQuestion(question)}
                    aria-label="Edit question"
                  >
                    ✏️
                  </button>
                </Tooltip>
              </div>
            ) : null}
            {suggestion && (
              <div className="suggestion-box answer-box center-answer-box">
                <h3>Your answer (read this aloud)</h3>
                <div className="answer-content answer-content-visible">
                  <ReactMarkdown>{suggestion}</ReactMarkdown>
                </div>
                {memorySavedMessage && (
                  <p className="memory-saved-badge">Last Q&amp;A kept for follow-ups (&quot;explain that&quot;, etc.).</p>
                )}
              </div>
            )}
            {!question && !suggestion && !error && (
              <p className="listening-placeholder">Ask a question… then press Stop to get your answer.</p>
            )}
          </div>
        </main>
      ) : (
      <main className="main pa-main scrollbar-none">
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
                      Position / role{" "}
                      <Tooltip label="Keeps answers on-topic">
                        <span className="pa-info" aria-hidden>
                          i
                        </span>
                      </Tooltip>
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
                      Interview type{" "}
                      <Tooltip label="Technical vs behavioral">
                        <span className="pa-info" aria-hidden>
                          i
                        </span>
                      </Tooltip>
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
                      Language{" "}
                      <Tooltip label="Speech recognition language">
                        <span className="pa-info" aria-hidden>
                          i
                        </span>
                      </Tooltip>
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
                  <div className="pa-field-header">
                    <span className="pa-field-label">
                      Microphone{" "}
                      <Tooltip label="Which input to open before listening">
                        <span className="pa-info" aria-hidden>
                          i
                        </span>
                      </Tooltip>
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        refreshAudioInputsWithPermission()
                          .then(setAudioInputDevices)
                          .catch(() => setError("Could not list microphones."));
                      }}
                    >
                      Refresh list
                    </button>
                  </div>
                  <select
                    className="pa-select"
                    value={selectedMicId}
                    onChange={(e) => setSelectedMicId(e.target.value)}
                  >
                    <option value="">Auto — default device (headset or built-in)</option>
                    {audioInputDevices.map((d, idx) => (
                      <option key={d.deviceId || `mic-${idx}`} value={d.deviceId}>
                        {d.label || `Microphone ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                  <p className="audio-tip" style={{ marginTop: "var(--space-2)", marginBottom: 0 }}>
                    We open this device before speech recognition so Windows uses the mic you expect (e.g. Bluetooth headphones).
                  </p>
                </div>
                <details className="pa-advanced">
                  <summary className="pa-advanced-summary">More options</summary>
                  <div className="pa-advanced-body">
                    <div className="pa-field">
                      <div className="pa-toggle-row">
                        <span className="pa-field-label" style={{ margin: 0 }}>
                          Simple language{" "}
                          <Tooltip label="Plain, easy-to-follow answers">
                            <span className="pa-info" aria-hidden>
                              i
                            </span>
                          </Tooltip>
                        </span>
                        <PaSwitch checked={simpleLanguage} onChange={setSimpleLanguage} />
                      </div>
                    </div>
                    <div className="pa-field">
                      <div className="pa-field-header">
                        <span className="pa-field-label">
                          Extra context / instructions{" "}
                          <Tooltip label="Sent to the model with each answer">
                            <span className="pa-info" aria-hidden>
                              i
                            </span>
                          </Tooltip>
                        </span>
                      </div>
                      <textarea
                        className="pa-textarea"
                        placeholder="e.g. use a casual tone."
                        value={extraSessionInstructions}
                        onChange={(e) => setExtraSessionInstructions(e.target.value)}
                        rows={3}
                      />
                    </div>
                    <div className="pa-field">
                      <div className="pa-field-header">
                        <span className="pa-field-label">
                          Resume{" "}
                          <Tooltip label="PDF or Word used as context">
                            <span className="pa-info" aria-hidden>
                              i
                            </span>
                          </Tooltip>
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
                            <Tooltip label="Remove resume">
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                aria-label="Remove resume"
                                onClick={() => {
                                  setDocumentText("");
                                  setDocumentFileName("");
                                  try {
                                    localStorage.removeItem(RESUME_TEXT_STORAGE_KEY);
                                    localStorage.removeItem(RESUME_NAME_STORAGE_KEY);
                                  } catch {
                                    /* ignore */
                                  }
                                }}
                              >
                                ×
                              </button>
                            </Tooltip>
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
                    </div>
                    <div className="pa-field">
                      <div className="pa-toggle-row">
                        <span className="pa-field-label" style={{ margin: 0 }}>
                          Save to Past Sessions{" "}
                          <Tooltip label="Archive Q&A in Past tab">
                            <span className="pa-info" aria-hidden>
                              i
                            </span>
                          </Tooltip>
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
                </details>
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
                    Listen with your mic or type. Headset vs speakers: pick the active mic below. For meeting audio, use Stereo Mix / loopback in Windows sound settings.
                  </p>

                  <div className="controls">
                    {!isListening ? (
                      <>
                        <Tooltip label={session && usage === null ? "Loading..." : undefined}>
                          <button
                            className="btn btn-primary"
                            onClick={startPractice}
                            disabled={!!(session && usage === null)}
                          >
                            {session && usage === null ? "Loading..." : "Start Listening"}
                          </button>
                        </Tooltip>
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
                          <Tooltip label="Generate answer from typed question">
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
                            >
                              Get answer
                            </button>
                          </Tooltip>
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
                      <Tooltip label="Edit question and get answer again">
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          onClick={() => setEditableQuestion(question)}
                          aria-label="Edit question"
                        >
                          ✏️
                        </button>
                      </Tooltip>
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
        onAnalyzeScreenDeep={() => void floatingAnalyzeScreenDeep()}
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
