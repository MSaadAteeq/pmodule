import { useState, useEffect } from "react";
import { tauriInvoke } from "../lib/tauri";
import "./UpgradeModal.css";

export function CloudModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    tauriInvoke<string | null>("get_cloud_url")
      .then((v) => setUrl(v ?? ""))
      .catch(() => setUrl(""));
  }, []);

  const handleSave = async () => {
    const value = url.trim();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await tauriInvoke("set_cloud_url", { base_url: value });
      setSuccess(value ? "Cloud URL saved. Sign in on this and other devices to sync." : "Cloud sync disabled. Using local data only.");
      setUrl(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal upgrade-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Cloud sync</h3>
        <p className="modal-desc">
          Set a Parakeet Cloud server URL to use the same account and usage on all your devices. Leave empty to use local data only.
        </p>
        <input
          type="url"
          className="input"
          placeholder="https://your-parakeet-cloud.example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ width: "100%", marginBottom: "var(--space-3)" }}
        />
        {error && <p className="modal-err">{error}</p>}
        {success && <p className="auth-success">{success}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
