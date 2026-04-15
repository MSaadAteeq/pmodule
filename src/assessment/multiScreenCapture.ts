/**
 * Sequential captures so the user can scroll the browser between shots; all images are sent in one vision request.
 */

import { capturePrimaryScreenPngBase64 } from "./screenCapture";
import type { CaptureRegionPhysical } from "./types";

export const MULTI_CAPTURE_COUNT = 3;
/** Brief pause so the status line is visible before the first grab. */
export const MULTI_CAPTURE_FIRST_DELAY_MS = 750;
/** Time to scroll between captures. */
export const MULTI_CAPTURE_BETWEEN_MS = 2800;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function multiCaptureStatusMessage(index: number): string {
  const n = MULTI_CAPTURE_COUNT;
  if (index === 0) {
    return `Capture 1/${n} — show the TOP of the problem (title, statement). Grabbing in a moment…`;
  }
  if (index === 1) {
    return `Scroll the page — capture 2/${n} soon (constraints, samples, I/O, language selector).`;
  }
  return `Scroll if needed — capture 3/${n} soon (any remaining text or editor language).`;
}

/**
 * Collects {@link MULTI_CAPTURE_COUNT} PNGs; calls `onStatus` before each wait so the user can scroll.
 */
export async function collectScrollStitchCaptures(
  onStatus: (message: string) => void,
  regionPhysical: CaptureRegionPhysical | null
): Promise<string[]> {
  const shots: string[] = [];
  for (let i = 0; i < MULTI_CAPTURE_COUNT; i++) {
    onStatus(multiCaptureStatusMessage(i));
    await sleep(i === 0 ? MULTI_CAPTURE_FIRST_DELAY_MS : MULTI_CAPTURE_BETWEEN_MS);
    shots.push(await capturePrimaryScreenPngBase64(regionPhysical));
  }
  return shots;
}
