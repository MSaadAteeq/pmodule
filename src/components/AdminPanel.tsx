import { useState, useEffect } from "react";
import { getStoredToken } from "../lib/auth";
import { tauriInvoke } from "../lib/tauri";
import "./AdminPanel.css";

type UserWithUsage = {
  id: string;
  email: string;
  role?: string;
  plan: string;
  sessions_remaining: number;
  plan_expires_at: string | null;
  last_coupon_code: string | null;
  account_paused?: boolean;
};

type CouponRow = {
  code: string;
  plan: string;
  sessions_granted: number | null;
  expires_at: string;
  created_at: string;
};

type PlanChoice = "free" | "pack_3" | "pack_10" | "unlimited";

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<UserWithUsage[]>([]);
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponPlan, setCouponPlan] = useState<"pack_3" | "pack_10" | "unlimited">("pack_3");
  const [couponDays, setCouponDays] = useState(30);
  const [adding, setAdding] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiKeySaving, setOpenaiKeySaving] = useState(false);
  const [openaiKeyMessage, setOpenaiKeyMessage] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; email: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; email: string } | null>(null);
  const [upgradeFor, setUpgradeFor] = useState<UserWithUsage | null>(null);
  const [upgradePlan, setUpgradePlan] = useState<PlanChoice>("pack_3");
  const [upgradeSessions, setUpgradeSessions] = useState(3);
  const [upgradeUnlimitedExpiry, setUpgradeUnlimitedExpiry] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);

  const token = getStoredToken();
  if (!token) return null;

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([
      tauriInvoke<UserWithUsage[]>("admin_list_users", { token }),
      tauriInvoke<CouponRow[]>("admin_list_coupons", { token }),
    ])
      .then(([u, c]) => {
        setUsers(u);
        setCoupons(c);
      })
      .catch((e) => setError(e?.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const removeSubscription = async (userId: string) => {
    setError("");
    try {
      await tauriInvoke("admin_remove_subscription", { args: { token, userId } });
      setConfirmRemove(null);
      load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : (e as { message?: string })?.message ?? "Failed";
      setError(msg);
    }
  };

  const setPaused = async (userId: string, paused: boolean) => {
    setError("");
    setAdminBusy(true);
    try {
      await tauriInvoke("admin_set_account_paused", { args: { token, userId, paused } });
      load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setAdminBusy(false);
    }
  };

  const deleteUser = async (userId: string) => {
    setError("");
    try {
      await tauriInvoke("admin_delete_user", { args: { token, userId } });
      setConfirmDelete(null);
      load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  };

  const openUpgrade = (u: UserWithUsage) => {
    const p = u.plan as PlanChoice;
    const planOk: PlanChoice = ["free", "pack_3", "pack_10", "unlimited"].includes(p) ? p : "free";
    setUpgradePlan(planOk);
    setUpgradeSessions(
      planOk === "pack_10" ? 10 : planOk === "pack_3" ? 3 : u.sessions_remaining ?? 0
    );
    setUpgradeUnlimitedExpiry(
      u.plan_expires_at ? u.plan_expires_at.slice(0, 16) : ""
    );
    setUpgradeFor(u);
  };

  const submitUpgrade = async () => {
    if (!upgradeFor) return;
    setError("");
    setAdminBusy(true);
    try {
      const sessionsRemaining =
        upgradePlan === "free" ? 0
        : upgradePlan === "pack_3" || upgradePlan === "pack_10" ? upgradeSessions
        : 0;
      const planExpiresAt =
        upgradePlan === "unlimited" && upgradeUnlimitedExpiry.trim()
          ? new Date(upgradeUnlimitedExpiry).toISOString()
          : null;
      await tauriInvoke("admin_set_user_plan", {
        args: {
          token,
          userId: upgradeFor.id,
          plan: upgradePlan,
          sessionsRemaining,
          planExpiresAt,
        },
      });
      setUpgradeFor(null);
      load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setAdminBusy(false);
    }
  };

  const addCoupon = async () => {
    const code = couponCode.trim().toUpperCase();
    if (!code) {
      setError("Enter a coupon code");
      return;
    }
    setAdding(true);
    setError("");
    try {
      await tauriInvoke("admin_add_coupon", {
        args: {
          token,
          code,
          plan: couponPlan,
          expiresInDays: Number(couponDays) || 30,
        },
      });
      setCouponCode("");
      load();
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message
        : typeof e === "string" ? e
        : (e as { message?: string })?.message
        ? (e as { message: string }).message
        : "Failed to add coupon";
      setError(msg);
    } finally {
      setAdding(false);
    }
  };

  const saveOpenaiKey = async () => {
    const key = openaiKey.trim();
    if (!key) {
      setOpenaiKeyMessage("Enter an API key");
      return;
    }
    setOpenaiKeySaving(true);
    setOpenaiKeyMessage("");
    setError("");
    try {
      await tauriInvoke("admin_set_openai_key", { args: { token, apiKey: key } });
      setOpenaiKeyMessage("OpenAI key saved. All users will use it.");
      setOpenaiKey("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Failed to save";
      setOpenaiKeyMessage(msg);
    } finally {
      setOpenaiKeySaving(false);
    }
  };

  const removeCoupon = async (code: string) => {
    if (!confirm(`Remove coupon "${code}"?`)) return;
    try {
      await tauriInvoke("admin_remove_coupon", { token, code });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal admin-panel" onClick={(e) => e.stopPropagation()}>
        <h3>Admin</h3>
        <p className="modal-desc">
          Superadmin: manage users (pause, delete, plan), coupons, OpenAI key, and subscriptions. Works against the same cloud URL users have configured, or local data when offline.
        </p>
        {error && <div className="auth-error" style={{ marginBottom: "0.75rem" }}>{error}</div>}

        <section className="admin-section">
          <h4>OpenAI API key</h4>
          <p className="admin-hint">Set once; all users use this key. Stored locally, not sent elsewhere.</p>
          <div className="admin-form">
            <input
              type="password"
              className="input"
              placeholder="sk-..."
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveOpenaiKey()}
            />
            <button type="button" className="btn btn-primary" onClick={saveOpenaiKey} disabled={openaiKeySaving}>
              {openaiKeySaving ? "..." : "Save key"}
            </button>
          </div>
          {openaiKeyMessage && (
            <p className={openaiKeyMessage.startsWith("OpenAI") ? "auth-success" : "auth-error"} style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
              {openaiKeyMessage}
            </p>
          )}
        </section>

        <section className="admin-section">
          <h4>Add coupon</h4>
          <div className="admin-form">
            <input
              type="text"
              className="input"
              placeholder="Code (e.g. WELCOME10)"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            />
            <select
              className="input"
              value={couponPlan}
              onChange={(e) => setCouponPlan(e.target.value as "pack_3" | "pack_10" | "unlimited")}
            >
              <option value="pack_3">3 sessions</option>
              <option value="pack_10">10 sessions</option>
              <option value="unlimited">Unlimited (1 month)</option>
            </select>
            <label className="admin-label">
              Expires in (days):{" "}
              <input
                type="number"
                min={1}
                max={365}
                className="input admin-input-num"
                value={couponDays}
                onChange={(e) => setCouponDays(parseInt(e.target.value, 10) || 1)}
              />
            </label>
            <button type="button" className="btn btn-primary" onClick={addCoupon} disabled={adding}>
              {adding ? "..." : "Add coupon"}
            </button>
          </div>
        </section>

        <section className="admin-section">
          <h4>Coupons (active)</h4>
          {loading ? (
            <p className="auth-message">Loading...</p>
          ) : coupons.length === 0 ? (
            <p className="auth-message">No active coupons.</p>
          ) : (
            <ul className="admin-list">
              {coupons.map((c) => (
                <li key={c.code} className="admin-list-item">
                  <span className="admin-coupon-code">{c.code}</span>
                  <span>{c.plan}</span>
                  <span>expires {new Date(c.expires_at).toLocaleDateString()}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeCoupon(c.code)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-section">
          <h4>Users & subscriptions</h4>
          {loading ? (
            <p className="auth-message">Loading...</p>
          ) : (
            <ul className="admin-list">
              {users.map((u) => {
                const isSuper = u.role === "superadmin";
                const paused = !!u.account_paused;
                return (
                  <li key={u.id} className="admin-list-item admin-user-row">
                    <div className="admin-user-info">
                      <span className="admin-user-email">{u.email}</span>
                      <span className="admin-user-meta">
                        {u.role && <span className="admin-badge admin-badge-role">{u.role}</span>}
                        {paused && <span className="admin-badge admin-badge-paused">paused</span>}
                      </span>
                      {u.last_coupon_code && (
                        <span className="admin-user-coupon">Coupon: {u.last_coupon_code}</span>
                      )}
                    </div>
                    <span className="admin-user-plan">{u.plan}</span>
                    {!isSuper && (
                      <div className="admin-user-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={adminBusy}
                          onClick={() => setPaused(u.id, !paused)}
                        >
                          {paused ? "Resume" : "Pause"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={adminBusy}
                          onClick={() => openUpgrade(u)}
                        >
                          Plan
                        </button>
                        {u.plan !== "free" && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-danger"
                            onClick={() => setConfirmRemove({ id: u.id, email: u.email })}
                          >
                            Clear plan
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-danger"
                          onClick={() => setConfirmDelete({ id: u.id, email: u.email })}
                        >
                          Delete user
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <button type="button" className="btn btn-ghost upgrade-close" onClick={onClose}>
          Close
        </button>
      </div>

      {confirmRemove && (
        <div className="modal-overlay confirm-overlay" onClick={() => setConfirmRemove(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Remove subscription</h3>
            <p className="confirm-message">
              Remove subscription for <strong>{confirmRemove.email}</strong>? They will revert to the free plan.
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmRemove(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => removeSubscription(confirmRemove.id)}
              >
                Remove subscription
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay confirm-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete user</h3>
            <p className="confirm-message">
              Permanently delete <strong>{confirmDelete.email}</strong> and all usage data? This cannot be undone.
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={() => deleteUser(confirmDelete.id)}>
                Delete user
              </button>
            </div>
          </div>
        </div>
      )}

      {upgradeFor && (
        <div className="modal-overlay confirm-overlay" onClick={() => !adminBusy && setUpgradeFor(null)}>
          <div className="modal confirm-modal admin-upgrade-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Set plan — {upgradeFor.email}</h3>
            <div className="admin-upgrade-fields">
              <label className="admin-label admin-label-block">
                Plan
                <select
                  className="input"
                  value={upgradePlan}
                  onChange={(e) => {
                    const p = e.target.value as PlanChoice;
                    setUpgradePlan(p);
                    if (p === "pack_3") setUpgradeSessions(3);
                    else if (p === "pack_10") setUpgradeSessions(10);
                    else if (p === "free") setUpgradeSessions(0);
                  }}
                >
                  <option value="free">free</option>
                  <option value="pack_3">pack_3</option>
                  <option value="pack_10">pack_10</option>
                  <option value="unlimited">unlimited</option>
                </select>
              </label>
              {(upgradePlan === "pack_3" || upgradePlan === "pack_10") && (
                <label className="admin-label admin-label-block">
                  Sessions remaining
                  <input
                    type="number"
                    min={0}
                    className="input"
                    value={upgradeSessions}
                    onChange={(e) => setUpgradeSessions(parseInt(e.target.value, 10) || 0)}
                  />
                </label>
              )}
              {upgradePlan === "unlimited" && (
                <label className="admin-label admin-label-block">
                  Expires (optional — leave empty for default +30 days)
                  <input
                    type="datetime-local"
                    className="input"
                    value={upgradeUnlimitedExpiry}
                    onChange={(e) => setUpgradeUnlimitedExpiry(e.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="confirm-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="btn btn-ghost" disabled={adminBusy} onClick={() => setUpgradeFor(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={adminBusy} onClick={() => void submitUpgrade()}>
                {adminBusy ? "..." : "Save plan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
