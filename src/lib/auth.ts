/**
 * Local auth via Tauri (SQLite). No Supabase or external setup.
 */

const STORAGE_KEY = "parakeet_session_token";

export type User = {
  id: string;
  email: string;
  role: string;
};

export function getStoredToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}
