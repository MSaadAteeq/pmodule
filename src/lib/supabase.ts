/**
 * Usage types and helpers. Auth and storage are now local (Tauri/SQLite).
 */

export type UserUsage = {
  id: string;
  user_id: string;
  minutes_used: number;
  sessions_used: number;
  plan: "free" | "pack_3" | "pack_10" | "unlimited";
  sessions_remaining: number;
  plan_expires_at: string | null;
  updated_at: string;
  /** True when superadmin paused this account (cloud or local). */
  account_paused?: boolean;
};

const FREE_MINUTES = 30;

export function canStartSession(usage: UserUsage | null): { allowed: boolean; reason?: string } {
  if (!usage) return { allowed: false, reason: "Loading usage..." };

  if (usage.account_paused) {
    return { allowed: false, reason: "Account paused. Contact support." };
  }

  if (usage.plan === "free") {
    if (usage.minutes_used >= FREE_MINUTES)
      return { allowed: false, reason: "Free 30 minutes used. Upgrade to continue." };
    return { allowed: true };
  }

  if (usage.plan === "unlimited") {
    if (usage.plan_expires_at && new Date(usage.plan_expires_at) < new Date())
      return { allowed: false, reason: "Monthly plan expired. Renew to continue." };
    return { allowed: true };
  }

  if (usage.plan === "pack_3" || usage.plan === "pack_10") {
    if (usage.sessions_remaining <= 0)
      return { allowed: false, reason: "No sessions left. Buy more below." };
    return { allowed: true };
  }

  return { allowed: true };
}

export function formatUsage(usage: UserUsage | null): string {
  if (!usage) return "";
  if (usage.plan === "free") {
    const left = Math.max(0, FREE_MINUTES - usage.minutes_used);
    return `${left.toFixed(1)} min free left`;
  }
  if (usage.plan === "unlimited") {
    const exp = usage.plan_expires_at ? new Date(usage.plan_expires_at) : null;
    return exp ? `Unlimited until ${exp.toLocaleDateString()}` : "Unlimited";
  }
  return `${usage.sessions_remaining} sessions left`;
}
