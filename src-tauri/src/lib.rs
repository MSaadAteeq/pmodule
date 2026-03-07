#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod db;

use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{ShortcutEvent, ShortcutState};

static LISTENING: AtomicBool = AtomicBool::new(false);

fn get_openai_key() -> Result<String, String> {
    db::get_openai_api_key()
}

#[derive(Debug, Deserialize)]
struct WhisperApiResponse {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Option<Vec<ChatChoice>>,
}

#[tauri::command]
async fn transcribe_and_answer(
    audio_base64: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let api_key = get_openai_key()?;
    let _ = app_handle.emit("status", "Backend received, decoding...");

    let audio_bytes = STANDARD
        .decode(audio_base64.trim())
        .map_err(|e| format!("Invalid audio data: {}", e))?;

    if audio_bytes.len() < 500 {
        return Ok(()); // Skip tiny chunks (likely silence)
    }

    let _ = app_handle.emit("status", "Calling Whisper...");

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    // Transcribe with Whisper
    let transcript = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(
            reqwest::multipart::Form::new()
                .part(
                    "file",
                    reqwest::multipart::Part::bytes(audio_bytes)
                        .file_name("audio.webm")
                        .mime_str("audio/webm")
                        .map_err(|e| e.to_string())?,
                )
                .text("model", "whisper-1")
                .text("response_format", "json")
                .text("language", "en")
                .text("prompt", "Interview question. Tell me about"),
        )
        .send()
        .await
        .map_err(|e| {
            let _ = app_handle.emit("backend_error", format!("Whisper: {}", e));
            format!("Whisper API error: {}", e)
        })?
        .json::<WhisperApiResponse>()
        .await
        .map_err(|e| {
            let _ = app_handle.emit("backend_error", format!("Whisper parse: {}", e));
            format!("Whisper parse error: {}", e)
        })?;

    let text = transcript.text.unwrap_or_default().trim().to_string();

    let _ = app_handle.emit("status", format!("Whisper heard: {} chars", text.len()));

    if text.is_empty() || text.len() < 5 {
        let _ = app_handle.emit(
            "answer",
            AnswerPayload {
                question: "—".to_string(),
                answer: "No speech detected in this chunk. Keep speaking for 3+ seconds."
                    .to_string(),
            },
        );
        return Ok(());
    }

    // Emit transcript to frontend
    let _ = app_handle.emit("transcript", &text);

    // Only generate answer if it looks like a question (has ? or common question words)
    let low = text.to_lowercase();
    let is_question = text.contains('?')
        || low.starts_with("what ")
        || low.starts_with("how ")
        || low.starts_with("why ")
        || low.starts_with("when ")
        || low.starts_with("where ")
        || low.starts_with("who ")
        || low.starts_with("can you")
        || low.starts_with("could you")
        || low.starts_with("would you")
        || low.starts_with("do you")
        || low.starts_with("are you")
        || low.starts_with("is there")
        || low.starts_with("tell me")
        || low.starts_with("explain")
        || low.starts_with("describe")
        || low.starts_with("write ")
        || low.starts_with("write a ")
        || low.starts_with("write an ")
        || low.starts_with("create ")
        || low.starts_with("create a ")
        || low.starts_with("implement ")
        || low.starts_with("show me")
        || low.starts_with("give me")
        || low.starts_with("walk me through")
        || low.starts_with("ok, ")
        || low.starts_with("okay, ");

    if !is_question {
        // Still show what we heard so user knows it's working
        let _ = app_handle.emit(
            "answer",
            AnswerPayload {
                question: text,
                answer: "(Not detected as a question. Try asking with What, How, Why, or add a ?)"
                    .to_string(),
            },
        );
        return Ok(());
    }

    let low = text.to_lowercase();
    let is_code = low.contains("write ") || low.contains("create ") || low.contains("implement ")
        || low.contains(" code") || low.contains("script") || low.starts_with("write ")
        || low.starts_with("create ") || low.starts_with("implement ");
    let prompt = format!(
        r#"You are an expert interview coach. The interviewer asked: "{}"

Rules:
- Infer every detail they want. Understand their tone and intent.
- If CODE (write/create/implement): Best production code in a markdown code block, then "Key concepts the interviewer may ask about" with bullet points (design, complexity, edge cases).
- Otherwise: Comprehensive answer, every relevant detail. Bullets OK if clearer."#,
        text
    );

    let chat_body = serde_json::json!({
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": "Lightning-fast interview assistant. Be thorough: fetch every detail, read interviewer emotion (curiosity, skepticism, urgency). Anticipate follow-ups. For code: best quality + bullet-point headings for follow-up Q&A."},
            {"role": "user", "content": prompt}
        ],
        "max_tokens": if is_code { 1200 } else { 600 },
        "temperature": 0.4
    });

    let chat_resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&chat_body)
        .send()
        .await
        .map_err(|e| format!("OpenAI API error: {}", e))?
        .json::<ChatResponse>()
        .await
        .map_err(|e| format!("OpenAI parse error: {}", e))?;

    let answer = chat_resp
        .choices
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.message.content)
        .unwrap_or_else(|| "Sorry, I couldn't generate an answer.".to_string())
        .trim()
        .to_string();

    let _ = app_handle.emit(
        "answer",
        AnswerPayload {
            question: text,
            answer,
        },
    );
    Ok(())
}

#[derive(Clone, serde::Serialize)]
struct AnswerPayload {
    question: String,
    answer: String,
}

#[tauri::command]
fn set_listening(listening: bool) {
    LISTENING.store(listening, Ordering::SeqCst);
}

#[tauri::command]
fn is_listening() -> bool {
    LISTENING.load(Ordering::SeqCst)
}

fn convert_webm_to_wav(webm_path: &std::path::Path) -> Result<Vec<u8>, String> {
    let wav_path = webm_path.with_extension("wav");
    let status = std::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            webm_path.to_str().ok_or("Invalid path")?,
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            wav_path.to_str().ok_or("Invalid path")?,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| format!("FFmpeg not found: {}", e))?;
    if !status.success() {
        return Err("FFmpeg conversion failed".to_string());
    }
    let wav_bytes = std::fs::read(&wav_path).map_err(|e| format!("Read WAV: {}", e))?;
    let _ = std::fs::remove_file(&wav_path);
    Ok(wav_bytes)
}

#[tauri::command]
async fn transcribe_from_file(app_handle: tauri::AppHandle) -> Result<(), String> {
    let api_key = get_openai_key()?;
    let file_path = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("parakeet_audio.webm");
    let _ = app_handle.emit("status", "Reading file...");
    let webm_bytes = std::fs::read(&file_path).map_err(|e| format!("Read file: {}", e))?;
    if webm_bytes.len() < 500 {
        let _ = std::fs::remove_file(&file_path);
        let _ = app_handle.emit(
            "answer",
            AnswerPayload {
                question: "—".to_string(),
                answer: "No speech detected. Keep speaking for 2+ seconds.".to_string(),
            },
        );
        return Ok(());
    }

    // Convert WebM to WAV for reliable Whisper transcription (WebM/Opus often fails)
    let (audio_bytes, file_name, mime) = match convert_webm_to_wav(&file_path) {
        Ok(wav) => {
            let _ = std::fs::remove_file(&file_path);
            (wav, "audio.wav".to_string(), "audio/wav".to_string())
        }
        Err(_) => {
            let _ = std::fs::remove_file(&file_path);
            (
                webm_bytes,
                "audio.webm".to_string(),
                "audio/webm".to_string(),
            )
        }
    };

    let _ = app_handle.emit("status", "Calling Whisper...");
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let transcript = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(
            reqwest::multipart::Form::new()
                .part(
                    "file",
                    reqwest::multipart::Part::bytes(audio_bytes)
                        .file_name(file_name)
                        .mime_str(&mime)
                        .map_err(|e| e.to_string())?,
                )
                .text("model", "whisper-1")
                .text("response_format", "json")
                .text("language", "en")
                .text("prompt", "Interview question. Tell me about"),
        )
        .send()
        .await
        .map_err(|e| {
            let _ = app_handle.emit("backend_error", format!("Whisper: {}", e));
            format!("Whisper API error: {}", e)
        })?
        .json::<WhisperApiResponse>()
        .await
        .map_err(|e| {
            let _ = app_handle.emit("backend_error", format!("Whisper parse: {}", e));
            format!("Whisper parse error: {}", e)
        })?;
    let text = transcript.text.unwrap_or_default().trim().to_string();
    let _ = app_handle.emit("status", format!("Heard {} chars", text.len()));
    if text.is_empty() || text.len() < 5 {
        let _ = app_handle.emit(
            "answer",
            AnswerPayload {
                question: "—".to_string(),
                answer: "No speech detected in this chunk.".to_string(),
            },
        );
        return Ok(());
    }
    let _ = app_handle.emit("transcript", &text);
    let low = text.to_lowercase();
    let is_question = text.contains('?')
        || low.starts_with("what ")
        || low.starts_with("how ")
        || low.starts_with("why ")
        || low.starts_with("when ")
        || low.starts_with("where ")
        || low.starts_with("who ")
        || low.starts_with("can you")
        || low.starts_with("could you")
        || low.starts_with("would you")
        || low.starts_with("do you")
        || low.starts_with("are you")
        || low.starts_with("is there")
        || low.starts_with("tell me")
        || low.starts_with("explain")
        || low.starts_with("describe")
        || low.starts_with("write ")
        || low.starts_with("write a ")
        || low.starts_with("write an ")
        || low.starts_with("create ")
        || low.starts_with("create a ")
        || low.starts_with("implement ")
        || low.starts_with("show me")
        || low.starts_with("give me")
        || low.starts_with("walk me through")
        || low.starts_with("ok, ")
        || low.starts_with("okay, ");
    if !is_question {
        let _ = app_handle.emit(
            "answer",
            AnswerPayload {
                question: text,
                answer: "(Not a question. Try What, How, Why, or ?)".to_string(),
            },
        );
        return Ok(());
    }
    let is_code = low.contains("write ") || low.contains("create ") || low.contains("implement ")
        || low.contains(" code") || low.contains("script") || low.starts_with("write ")
        || low.starts_with("create ") || low.starts_with("implement ");
    let prompt = format!(
        r#"You are an expert interview coach. The interviewer asked: "{}"

Rules:
- Infer every detail they want. Understand their tone and intent.
- If CODE (write/create/implement): Best production code in a markdown code block, then "Key concepts the interviewer may ask about" with bullet points (design, complexity, edge cases).
- Otherwise: Comprehensive answer, every relevant detail. Bullets OK if clearer."#,
        text
    );
    let chat_body = serde_json::json!({
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": "Lightning-fast interview assistant. Be thorough: fetch every detail, read interviewer emotion (curiosity, skepticism, urgency). Anticipate follow-ups. For code: best quality + bullet-point headings for follow-up Q&A."},
            {"role": "user", "content": prompt}
        ],
        "max_tokens": if is_code { 1200 } else { 600 },
        "temperature": 0.4
    });
    let chat_resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&chat_body)
        .send()
        .await
        .map_err(|e| format!("OpenAI API error: {}", e))?
        .json::<ChatResponse>()
        .await
        .map_err(|e| format!("OpenAI parse error: {}", e))?;
    let answer = chat_resp
        .choices
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.message.content)
        .unwrap_or_else(|| "Sorry.".to_string())
        .trim()
        .to_string();
    let _ = app_handle.emit(
        "answer",
        AnswerPayload {
            question: text,
            answer,
        },
    );
    Ok(())
}

/// Generate GPT answer from transcript (used when frontend uses Web Speech API)
#[tauri::command]
async fn answer_from_transcript(
    transcript: String,
    interview_context: Option<String>,
    document_text: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let api_key = get_openai_key()?;
    let text = transcript.trim().to_string();
    if text.len() < 3 {
        let _ = app_handle.emit(
            "answer",
            AnswerPayload {
                question: "—".to_string(),
                answer: "No speech detected. Speak clearly and try again.".to_string(),
            },
        );
        return Ok(());
    }
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let low = text.to_lowercase();
    let is_question = text.contains('?')
        || low.starts_with("what ")
        || low.starts_with("how ")
        || low.starts_with("why ")
        || low.starts_with("when ")
        || low.starts_with("where ")
        || low.starts_with("who ")
        || low.starts_with("can you")
        || low.starts_with("could you")
        || low.starts_with("would you")
        || low.starts_with("do you")
        || low.starts_with("are you")
        || low.starts_with("is there")
        || low.starts_with("tell me")
        || low.starts_with("explain")
        || low.starts_with("describe")
        || low.starts_with("write ")
        || low.starts_with("write a ")
        || low.starts_with("write an ")
        || low.starts_with("create ")
        || low.starts_with("create a ")
        || low.starts_with("implement ")
        || low.starts_with("show me")
        || low.starts_with("give me")
        || low.starts_with("walk me through")
        || low.starts_with("ok, ")
        || low.starts_with("okay, ");
    if !is_question {
        let _ = app_handle.emit(
            "answer",
            AnswerPayload {
                question: text,
                answer: "(Not detected as a question. Try What, How, Why, or add ?)".to_string(),
            },
        );
        return Ok(());
    }

    const DOC_MAX_CHARS: usize = 8000;
    let doc_trimmed = document_text
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| {
            if s.len() > DOC_MAX_CHARS {
                format!("{}...", &s[..DOC_MAX_CHARS])
            } else {
                s.to_string()
            }
        });

    let has_document = doc_trimmed.is_some();
    let context_block = match (&interview_context, &doc_trimmed) {
        (Some(ctx), Some(doc)) if !ctx.is_empty() => format!(
            "The candidate is interviewing for: {}.\n\nReference document (the candidate's notes/resource - USE THIS to answer):\n---\n{}\n---",
            ctx.trim(),
            doc
        ),
        (Some(ctx), _) if !ctx.is_empty() => format!(
            "The candidate is interviewing for: {}. Use this to disambiguate (e.g. React = ReactJS for a frontend role).",
            ctx.trim()
        ),
        (_, Some(doc)) => format!(
            "Reference document (the candidate's notes/resource - USE THIS to answer):\n---\n{}\n---",
            doc
        ),
        _ => String::new(),
    };

    let document_instruction = if has_document {
        "When a reference document is provided, you MUST base your answer on it. Use that content and wording; do not substitute a generic answer."
    } else {
        ""
    };

    let is_code_question = {
        let low = text.to_lowercase();
        low.contains("write ") || low.contains("create ") || low.contains("implement ")
            || low.contains(" code") || low.contains("script") || low.contains("function ")
            || low.starts_with("write ") || low.starts_with("create ") || low.starts_with("implement ")
    };

    let system_content = format!(
        r#"You are an expert interview coach. Your answers must be LIGHTNING-FAST to deliver, comprehensive, and interview-ready.

DEPTH & INTELLIGENCE:
- Infer EVERY detail the interviewer wants from their question and tone. Read between the lines: if they seem probing, cover edge cases; if they seem time-pressed, be concise but complete.
- Understand interviewer intent and emotion: curiosity, skepticism, urgency, or "testing depth" — tailor your answer accordingly.
- Leave nothing out that a senior interviewer would expect. Anticipate follow-up questions and preempt them.
{}

CODE QUESTIONS (write/create/implement): Provide the BEST possible production-quality code. Use a markdown code block with language. Then add a heading "Key concepts the interviewer may ask about" and bullet points for: design decisions, time/space complexity, edge cases, alternative approaches. This lets the candidate answer follow-ups easily.

NON-CODE: Clear, comprehensive answer. Include every relevant detail. Can use bullets for clarity. Aim to be thorough but speakable aloud."#,
        if document_instruction.is_empty() { String::new() } else { format!("\nREFERENCE DOCUMENT: {}\n", document_instruction) }
    );

    let user_content = if context_block.is_empty() {
        format!("Interviewer asked: \"{}\"\n\nAnswer comprehensively. Cover every aspect they might care about.", text)
    } else {
        format!(
            "Context:\n{}\n\nInterviewer asked: \"{}\"\n\nAnswer comprehensively. Use the context when relevant. Cover every aspect they might care about.",
            context_block, text
        )
    };

    let max_tokens = if is_code_question { 1500 } else { 900 };

    let chat_body = serde_json::json!({
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content}
        ],
        "max_tokens": max_tokens,
        "temperature": 0.4,
        "stream": true
    });

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&chat_body)
        .send()
        .await
        .map_err(|e| {
            let _ = app_handle.emit("backend_error", format!("OpenAI: {}", e));
            format!("OpenAI API error: {}", e)
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let err_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        let _ = app_handle.emit("backend_error", format!("OpenAI API error: {}", err_body));
        return Err(format!("API error ({}): {}", status, err_body));
    }

    let mut stream = response.bytes_stream();
    let mut buf = String::new();
    let mut full_answer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| {
            let _ = app_handle.emit("backend_error", format!("Stream: {}", e));
            format!("Stream error: {}", e)
        })?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        let lines: Vec<&str> = buf.split('\n').collect();
        let last = lines.last().map(|s| *s).unwrap_or("");
        let complete = if lines.len() > 1 {
            &lines[..lines.len() - 1]
        } else {
            &lines[..0]
        };
        for line in complete {
            let line = line.trim();
            if line.starts_with("data: ") {
                let data = line.strip_prefix("data: ").unwrap_or("");
                if data == "[DONE]" {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(delta) = v
                        .get("choices")
                        .and_then(|c| c.as_array())
                        .and_then(|c| c.first())
                        .and_then(|c| c.get("delta"))
                        .and_then(|d| d.get("content"))
                    {
                        if let Some(t) = delta.as_str() {
                            full_answer.push_str(t);
                            let _ = app_handle.emit("answer_chunk", t);
                        }
                    }
                }
            }
        }
        buf = last.to_string();
    }

    let answer = full_answer.trim().to_string();
    let _ = app_handle.emit(
        "answer",
        AnswerPayload {
            question: text,
            answer: if answer.is_empty() {
                "Sorry, no response generated.".to_string()
            } else {
                answer
            },
        },
    );
    Ok(())
}

// ---- Local auth & usage (no Supabase) ----

#[tauri::command]
fn auth_login(email: String, password: String) -> Result<(String, db::User), String> {
    db::auth_login(&email, &password)
}

#[tauri::command]
fn auth_signup(email: String, password: String) -> Result<(String, db::User), String> {
    db::auth_signup(&email, &password)
}

#[tauri::command]
fn auth_logout(token: String) -> Result<(), String> {
    db::auth_logout(&token)
}

#[tauri::command]
fn auth_session(token: String) -> Result<db::User, String> {
    db::auth_validate_token(&token)
}

#[tauri::command]
fn get_usage(token: String) -> Result<db::UserUsageRow, String> {
    db::get_usage(&token)
}

#[tauri::command]
fn record_session_cmd(token: String, minutes: f64) -> Result<db::UserUsageRow, String> {
    db::record_session(&token, minutes)
}

#[tauri::command]
fn apply_coupon(token: String, code: String) -> Result<db::UserUsageRow, String> {
    db::apply_coupon(&token, &code)
}

#[tauri::command]
fn admin_list_users(token: String) -> Result<Vec<db::UserWithUsage>, String> {
    db::admin_list_users(&token)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminRemoveSubscriptionArgs {
    token: String,
    user_id: String,
}

#[tauri::command]
fn admin_remove_subscription(args: AdminRemoveSubscriptionArgs) -> Result<(), String> {
    db::admin_remove_subscription(&args.token, &args.user_id)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminAddCouponArgs {
    token: String,
    code: String,
    plan: String,
    expires_in_days: i64,
}

#[tauri::command]
fn admin_add_coupon(args: AdminAddCouponArgs) -> Result<(), String> {
    db::admin_add_coupon(&args.token, &args.code, &args.plan, args.expires_in_days)
}

#[tauri::command]
fn admin_remove_coupon(token: String, code: String) -> Result<(), String> {
    db::admin_remove_coupon(&token, &code)
}

#[tauri::command]
fn admin_list_coupons(token: String) -> Result<Vec<db::CouponRow>, String> {
    db::admin_list_coupons(&token)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminSetOpenaiKeyArgs {
    token: String,
    api_key: String,
}

#[tauri::command]
fn admin_set_openai_key(args: AdminSetOpenaiKeyArgs) -> Result<(), String> {
    db::admin_set_openai_key(&args.token, &args.api_key)
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            let db_path = path.join("parakeet.db");
            db::init_db(&db_path)?;
            Ok(())
        })
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["Control+Alt+KeyA"])
                .expect("failed to register shortcut")
                .with_handler(|app, _shortcut, event: ShortcutEvent| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.set_ignore_cursor_events(false);
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                            let _ = w.emit("parakeet_activate", ());
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            transcribe_and_answer,
            transcribe_from_file,
            answer_from_transcript,
            set_listening,
            is_listening,
            auth_login,
            auth_signup,
            auth_logout,
            auth_session,
            get_usage,
            record_session_cmd,
            apply_coupon,
            admin_list_users,
            admin_remove_subscription,
            admin_add_coupon,
            admin_remove_coupon,
            admin_list_coupons,
            admin_set_openai_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI Assistant");
}
