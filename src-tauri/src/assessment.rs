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

const VISION_SYSTEM: &str = r#"You help interpret on-screen questions: screenshots, diagrams, or pasted text from technical screenings and practice tests.
Always respond with a single JSON object only (no markdown fences).
Use these exact key names: questionType, extractedQuestion, correctAnswer, briefExplanation.

questionType must be one of: mcq, fill_blank, true_false, logic, image_puzzle, code_output, short_programming, unknown.

extractedQuestion: full readable stem; include all multiple-choice options as labeled in the image.
correctAnswer: what the user should enter or select (e.g. option letter + text, fill-in text, True/False, program output, or short code).
briefExplanation: 1–3 sentences; omit only if nothing useful to add.

For code-output questions, mentally trace execution and give the exact output.
For image or pattern puzzles, use the visual content."#;

pub async fn analyze_image_base64(
    api_key: &str,
    png_base64: &str,
    interview_context: Option<&str>,
) -> Result<AssessmentResult, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let ctx = interview_context
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("Context from user (role/topic): {}\n\n", s))
        .unwrap_or_default();

    let user_text = format!(
        "{}Analyze the attached screenshot and fill the JSON fields.",
        ctx
    );

    let body = serde_json::json!({
        "model": "gpt-4o-mini",
        "messages": [
            { "role": "system", "content": VISION_SYSTEM },
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": user_text },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:image/png;base64,{}", png_base64.trim())
                        }
                    }
                ]
            }
        ],
        "max_tokens": 1600,
        "temperature": 0.15,
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
        "max_tokens": 1600,
        "temperature": 0.15,
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
