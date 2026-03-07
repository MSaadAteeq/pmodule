import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: "" };

  static getDerivedStateFromError(err: Error) {
    return { hasError: true, error: err.message };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("App error:", err, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "2rem", background: "#0f172a", color: "#f1f5f9", minHeight: "100vh", fontFamily: "system-ui" }}>
          <h2 style={{ color: "#22c55e" }}>Something went wrong</h2>
          <p style={{ color: "#94a3b8" }}>{this.state.error}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: "" })}
            style={{ padding: "0.5rem 1rem", background: "#22c55e", color: "#fff", border: "none", borderRadius: "0.5rem", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
