//! Vision + text analysis for on-screen assessment questions (screenshot-only; no keylogging).
//! Uses OpenAI multimodal chat; configure API key in app settings like the rest of the assistant.

use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentResult {
    #[serde(default)]
    pub question_type: String,
    #[serde(default)]
    pub extracted_question: String,
    #[serde(default)]
    pub correct_answer: String,
    #[serde(default)]
    pub brief_explanation: String,
}

const VISION_MODEL: &str = "gpt-4o";

const VISION_SYSTEM: &str = r#"You interpret on-screen interview and assessment content: screenshots, IDE windows, LeetCode/HackerRank-style pages, MCQs, and pasted text.
Always respond with a single JSON object only (no markdown fences).
Use these exact key names: questionType, extractedQuestion, correctAnswer, briefExplanation.

questionType must be one of: mcq, fill_blank, true_false, logic, image_puzzle, code_output, short_programming, unknown.

extractedQuestion:
- For non-coding: full readable stem; include every multiple-choice option exactly as labeled.
- For coding challenges: reproduce the COMPLETE problem as you see it — title, narrative, ALL constraints, time/memory limits, input/output format, and EVERY sample input/output block. If the language selector or editor tab shows a language, state it here too. Do not skip examples.

correctAnswer:
- For non-coding: what to enter or select (option letter + text, fill-in, True/False, traced program output, etc.).
- For coding: a complete, runnable solution in the SAME programming language shown in the UI (dropdown, tab, or editor). Match that language exactly (Python, Java, C++, JavaScript, TypeScript, Go, etc.). If the language is ambiguous, pick the most likely from the editor and say your assumption in briefExplanation.

briefExplanation: 1–4 sentences; for coding, mention I/O format or edge cases you relied on. If something critical is missing or unreadable in the image(s), say so here.

Rules:
- Read small text carefully (constraints, examples, boilerplate).
- For code-output/trace questions, execute mentally and give exact output.
- Never invent sample I/O; only use what appears on screen.
- If multiple images are provided, they are scroll positions of the SAME page — merge into one problem; do not treat as separate questions."#;

const VISION_MULTI_NOTE: &str = "Multiple images: same browser window after scrolling. Merge all visible text into one problem before answering.";

pub async fn analyze_image_base64(
    api_key: &str,
    png_base64: &str,
    interview_context: Option<&str>,
) -> Result<AssessmentResult, String> {
    let one = vec![png_base64.to_string()];
    analyze_images_base64(api_key, &one, interview_context).await
}

pub async fn analyze_images_base64(
    api_key: &str,
    png_base64_list: &[String],
    interview_context: Option<&str>,
) -> Result<AssessmentResult, String> {
    if png_base64_list.is_empty() {
        return Err("At least one screenshot is required".to_string());
    }
    if png_base64_list.len() > 6 {
        return Err("Too many images (max 6)".to_string());
    }

    let timeout_secs: u64 = if png_base64_list.len() > 1 { 180 } else { 120 };
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())?;

    let ctx = interview_context
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("Context from user (role/topic): {}\n\n", s))
        .unwrap_or_default();

    let multi = if png_base64_list.len() > 1 {
        format!("\n\n{}", VISION_MULTI_NOTE)
    } else {
        String::new()
    };

    let user_text = format!(
        "{}Analyze the attached screenshot(s) and fill the JSON fields.{}",
        ctx, multi
    );

    let mut content: Vec<serde_json::Value> = vec![serde_json::json!({
        "type": "text",
        "text": user_text
    })];

    for b64 in png_base64_list {
        content.push(serde_json::json!({
            "type": "image_url",
            "image_url": {
                "url": format!("data:image/png;base64,{}", b64.trim()),
                "detail": "high"
            }
        }));
    }

    let body = serde_json::json!({
        "model": VISION_MODEL,
        "messages": [
            { "role": "system", "content": VISION_SYSTEM },
            {
                "role": "user",
                "content": content
            }
        ],
        "max_tokens": 4096,
        "temperature": 0.1,
        "response_format": { "type": "json_object" }
    });

    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    if !resp.status().is_success() {
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error: {}", t));
    }

    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "Empty model response".to_string())?;

    parse_assessment_json(content)
}

pub async fn analyze_question_text(
    api_key: &str,
    question_text: &str,
    interview_context: Option<&str>,
) -> Result<AssessmentResult, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    let ctx = interview_context
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("Context from user (role/topic): {}\n\n", s))
        .unwrap_or_default();

    let user_text = format!(
        "{}Question or exercise text (may include code):\n---\n{}\n---\n\nReturn the same JSON object shape as in your instructions.",
        ctx,
        question_text.trim()
    );

    let body = serde_json::json!({
        "model": "gpt-4o-mini",
        "messages": [
            { "role": "system", "content": VISION_SYSTEM },
            { "role": "user", "content": user_text }
        ],
        "max_tokens": 4096,
        "temperature": 0.1,
        "response_format": { "type": "json_object" }
    });

    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    if !resp.status().is_success() {
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error: {}", t));
    }

    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "Empty model response".to_string())?;

    parse_assessment_json(content)
}

fn parse_assessment_json(content: &str) -> Result<AssessmentResult, String> {
    let trimmed = content.trim();
    let json_slice = if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        &trimmed[start..=end]
    } else {
        trimmed
    };

    serde_json::from_str::<AssessmentResult>(json_slice).map_err(|e| {
        format!(
            "Could not parse model JSON: {}. Raw (truncated): {}",
            e,
            truncate(json_slice, 400)
        )
    })
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}
