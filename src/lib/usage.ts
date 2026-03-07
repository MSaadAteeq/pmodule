/**
 * Usage and session recording via Tauri (local SQLite). No Supabase.
 */

import type { UserUsage } from "./supabase";

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const w = typeof window !== "undefined" ? (window as Window & { __TAURI_INTERNALS__?: { invoke: (c: string, a?: unknown) => Promise<T> } }) : null;
  const internals = w?.__TAURI_INTERNALS__;
  if (!internals?.invoke) {
    throw new Error("Tauri is not loaded. Run the app with 'npm run tauri dev'.");
  }
  return internals.invoke(cmd, args ?? {});
}

export async function fetchOrCreateUsage(token: string): Promise<UserUsage | null> {
  try {
    const row = await tauriInvoke<{
      id: string;
      user_id: string;
      minutes_used: number;
      sessions_used: number;
      plan: string;
      sessions_remaining: number;
      plan_expires_at: string | null;
      updated_at: string;
    }>("get_usage", { token });
    return {
      ...row,
      plan: row.plan as UserUsage["plan"],
    };
  } catch {
    return null;
  }
}

export async function recordSession(token: string, minutes: number): Promise<UserUsage | null> {
  try {
    const row = await tauriInvoke<{
      id: string;
      user_id: string;
      minutes_used: number;
      sessions_used: number;
      plan: string;
      sessions_remaining: number;
      plan_expires_at: string | null;
      updated_at: string;
    }>("record_session_cmd", { token, minutes });
    return {
      ...row,
      plan: row.plan as UserUsage["plan"],
    };
  } catch {
    return null;
  }
}

export async function applyCoupon(token: string, code: string): Promise<UserUsage | null> {
  try {
    const row = await tauriInvoke<{
      id: string;
      user_id: string;
      minutes_used: number;
      sessions_used: number;
      plan: string;
      sessions_remaining: number;
      plan_expires_at: string | null;
      updated_at: string;
    }>("apply_coupon", { token, code });
    return {
      ...row,
      plan: row.plan as UserUsage["plan"],
    };
  } catch {
    return null;
  }
}
