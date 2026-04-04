//! Primary-display screen capture for assessment assist.
//! Uses OS screen APIs (no keylogging). Requires screen-recording permission on macOS and Windows as applicable.

use base64::{engine::general_purpose::STANDARD, Engine};
use screenshots::image::{DynamicImage, ImageFormat};
use screenshots::Screen;

/// Capture region in **physical** pixels (same space as `Screen::capture`).
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Returns PNG file bytes as standard base64 (no data-URL prefix).
pub fn capture_primary_display_png_base64(region: Option<CaptureRegion>) -> Result<String, String> {
    let screens = Screen::all().map_err(|e| format!("Could not enumerate displays: {}", e))?;
    let screen = pick_primary_or_first(&screens).ok_or_else(|| "No display found".to_string())?;

    let rgba = match region {
        Some(r) => {
            if r.width == 0 || r.height == 0 {
                return Err("Capture region width and height must be positive".to_string());
            }
            screen
                .capture_area(r.x, r.y, r.width, r.height)
                .map_err(|e| {
                    format!(
                        "Region capture failed: {}. Check screen recording permission and that the region is on the primary monitor.",
                        e
                    )
                })?
        }
        None => screen.capture().map_err(|e| {
            format!(
                "Full-screen capture failed: {}. Grant screen recording / capture permission for this app.",
                e
            )
        })?,
    };

    let dyn_img = DynamicImage::ImageRgba8(rgba);
    let mut bytes = Vec::new();
    dyn_img
        .write_to(&mut std::io::Cursor::new(&mut bytes), ImageFormat::Png)
        .map_err(|e| format!("PNG encoding failed: {}", e))?;

    Ok(STANDARD.encode(bytes))
}

fn pick_primary_or_first(screens: &[Screen]) -> Option<&Screen> {
    screens
        .iter()
        .find(|s| s.display_info.is_primary)
        .or_else(|| screens.first())
}
