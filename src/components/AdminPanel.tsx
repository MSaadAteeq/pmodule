import { useState, useEffect } from "react";
import { getStoredToken } from "../lib/auth";
import { tauriInvoke } from "../lib/tauri";
import "./AdminPanel.css";

type UserWithUsage = {
  id: string;
  email: string;
  plan: string;
  sessions_remaining: number;
  plan_expires_at: string | null;
  last_coupon_code: string | null;
};

type CouponRow = {
  code: string;
  plan: string;
  sessions_granted: number | null;
  expires_at: string;
  created_at: string;
};

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
        <p className="modal-desc">Superadmin: set OpenAI key, manage coupons, remove subscriptions.</p>
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
              {users.map((u) => (
                <li key={u.id} className="admin-list-item admin-user-row">
                  <div className="admin-user-info">
                    <span className="admin-user-email">{u.email}</span>
                    {u.last_coupon_code && (
                      <span className="admin-user-coupon">Coupon: {u.last_coupon_code}</span>
                    )}
                  </div>
                  <span className="admin-user-plan">{u.plan}</span>
                  {u.plan !== "free" && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() => setConfirmRemove({ id: u.id, email: u.email })}
                    >
                      Remove subscription
                    </button>
                  )}
                </li>
              ))}
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
    </div>
  );
}
