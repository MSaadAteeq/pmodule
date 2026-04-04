/**
 * Captures the primary display via Tauri (native OS APIs).
 * Coordinates for regions are in **physical** pixels (multiply logical CSS pixels by window scale factor).
 */

import { tauriInvoke } from "../lib/tauri";
import type { CaptureRegionPhysical } from "./types";

export async function capturePrimaryScreenPngBase64(
  regionPhysical: CaptureRegionPhysical | null
): Promise<string> {
  return tauriInvoke<string>("capture_screen_png_base64", {
    region: regionPhysical ?? undefined,
  });
}
