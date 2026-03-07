import { useState } from "react";
import { getStoredToken } from "../lib/auth";
import { applyCoupon } from "../lib/usage";
import type { UserUsage } from "../lib/supabase";
import "./UpgradeModal.css";

export function UpgradeModal({
  onClose,
  onApplied,
  onUsageUpdate,
}: {
  onClose: () => void;
  onApplied?: () => void;
  onUsageUpdate?: (usage: UserUsage | null) => void;
}) {
  const [coupon, setCoupon] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");

  const handleApplyCoupon = async () => {
    const code = coupon.trim();
    if (!code) {
      setErr("Enter a coupon code");
      return;
    }
    const token = getStoredToken();
    if (!token) {
      setErr("Not signed in");
      return;
    }
    setErr("");
    setSuccess("");
    setLoading(true);
    try {
      const updated = await applyCoupon(token, code);
      if (updated) {
        setSuccess("Coupon applied! Your plan has been updated.");
        onUsageUpdate?.(updated);
        setCoupon("");
        setTimeout(() => {
          onApplied?.();
          onClose();
        }, 800);
      } else {
        setErr("Invalid or expired coupon.");
      }
    } catch (e) {
      setErr("Failed to apply coupon.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal upgrade-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Upgrade</h3>
        <p className="modal-desc">
          First 30 minutes free. Apply a coupon code to get more sessions or unlimited access.
        </p>
        {err && <div className="auth-error" style={{ marginBottom: "0.75rem" }}>{err}</div>}
        {success && <div className="auth-success" style={{ marginBottom: "0.75rem" }}>{success}</div>}
        <div className="coupon-row">
          <input
            type="text"
            className="input"
            placeholder="Coupon code"
            value={coupon}
            onChange={(e) => setCoupon(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleApplyCoupon()}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleApplyCoupon}
            disabled={loading}
          >
            {loading ? "..." : "Apply"}
          </button>
        </div>
        <p className="auth-message" style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
          Coupons can grant: 3 sessions, 10 sessions, or 1 month unlimited. Ask your admin for a code.
        </p>
        <button type="button" className="btn btn-ghost upgrade-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
