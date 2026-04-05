/** Pick which capture device to prime before Web Speech API (helps OS/WebView route the right mic). */

const STORAGE_KEY = "parakeet-preferred-mic-id";

export function getStoredMicId(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

export function setStoredMicId(deviceId: string) {
  if (!deviceId) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, deviceId);
}

export async function listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const list = await navigator.mediaDevices.enumerateDevices();
  return list.filter((d) => d.kind === "audioinput");
}

/** Request permission and return inputs (labels often appear only after permission). */
export async function refreshAudioInputsWithPermission(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.getUserMedia) return [];
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
  return listAudioInputDevices();
}

export async function primeMicrophoneStream(deviceId: string | null): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is not available in this environment.");
  }
  const constraints: MediaStreamConstraints = {
    audio: deviceId
      ? {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
        }
      : {
          echoCancellation: true,
          noiseSuppression: true,
        },
  };
  return navigator.mediaDevices.getUserMedia(constraints);
}
