import { useState } from "react";
import { tauriInvoke, isTauri } from "../lib/tauri";
import { setStoredToken } from "../lib/auth";
import "./AuthScreen.css";

type AuthMode = "login" | "signup";

export function AuthScreen({
  onAuth,
}: {
  onAuth: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!isTauri()) {
      setError("Please run the desktop app (npm run tauri dev) to sign in.");
      return;
    }
    setLoading(true);
    try {
      const cmd = mode === "signup" ? "auth_signup" : "auth_login";
      const result = await tauriInvoke<[string, { id: string; email: string; role: string }]>(cmd, {
        email: email.trim(),
        password,
      });
      const [token] = result;
      setStoredToken(token);
      onAuth();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setLoading(false);
    }
  };

  if (!isTauri()) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h2>AI Assistant</h2>
          <p className="auth-message">
            Open the desktop app to sign in. Run: <code>npm run tauri dev</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h2>AI Assistant</h2>
        <p className="auth-subtitle">Sign in to get 30 minutes free, then use a coupon to upgrade.</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <input
            type="email"
            className="input"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            type="password"
            className="input"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
          {error && <div className="auth-error">{error}</div>}
          {message && <div className="auth-success">{message}</div>}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "..." : mode === "login" ? "Sign in" : "Sign up"}
          </button>
        </form>
        <button
          type="button"
          className="btn btn-ghost btn-sm auth-toggle"
          onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setMessage(""); }}
        >
          {mode === "login" ? "Create account" : "Back to sign in"}
        </button>
      </div>
    </div>
  );
}
