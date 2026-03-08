import { useState, useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./UpgradeModal.css";

/** Parse release notes into 3–4 bullet points for display */
function parseReleaseNotes(body: string | null | undefined): string[] {
  if (!body || typeof body !== "string") return [];
  const trimmed = body.trim();
  if (!trimmed) return [];
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s*\-•]+/, "").trim())
    .filter(Boolean);
  const points: string[] = [];
  for (const line of lines) {
    if (points.length >= 4) break;
    if (line.length > 5) points.push(line);
  }
  return points.length > 0 ? points : [trimmed];
}

export function UpdateModal({
  onClose,
  onNoUpdate,
}: {
  onClose: () => void;
  onNoUpdate?: (message: string) => void;
}) {
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [updateInstance, setUpdateInstance] = useState<Awaited<ReturnType<typeof check>>>(null);

  useEffect(() => {
    runCheck();
  }, []);

  const runCheck = async () => {
    setChecking(true);
    setError("");
    setVersion("");
    setNotes([]);
    setUpdateInstance(null);
    try {
      const update = await check();
      if (update) {
        setVersion(update.version);
        setNotes(parseReleaseNotes(update.body));
        setUpdateInstance(update);
      } else {
        onNoUpdate?.("You're on the latest version.");
        onClose();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to check for updates.";
      setError(msg);
      onNoUpdate?.(msg);
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async () => {
    if (!updateInstance) return;
    setDownloading(true);
    setError("");
    try {
      await updateInstance.downloadAndInstall(() => {});
      await relaunch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Install failed.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal upgrade-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Update</h3>
        {checking ? (
          <p className="modal-desc">Checking for updates…</p>
        ) : error && !updateInstance ? (
          <>
            <p className="modal-desc">{error}</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
              <button type="button" className="btn btn-primary" onClick={runCheck}>
                Retry
              </button>
            </div>
          </>
        ) : updateInstance ? (
          <>
            <p className="modal-desc">
              Version <strong>{version}</strong> is available.
            </p>
            {notes.length > 0 && (
              <ul className="update-notes">
                {notes.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
            {error && <p className="modal-err">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Later
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleInstall}
                disabled={downloading}
              >
                {downloading ? "Downloading…" : "Update now"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
