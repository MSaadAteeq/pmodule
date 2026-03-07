export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & { __TAURI_INTERNALS__?: unknown };
  return Boolean(w?.__TAURI_INTERNALS__);
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const w = typeof window !== "undefined" ? (window as Window & { __TAURI_INTERNALS__?: { invoke: (c: string, a?: unknown) => Promise<T> } }) : null;
  const internals = w?.__TAURI_INTERNALS__;
  if (!internals?.invoke) {
    throw new Error(
      "Tauri is not loaded. Run the app with 'npm run tauri dev' or use the installed .exe."
    );
  }
  return internals.invoke(cmd, args ?? {});
}
