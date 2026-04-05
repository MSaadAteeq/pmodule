import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./Tooltip.css";

type TooltipProps = {
  /** Tooltip text; omit or empty to disable and render children only. */
  label?: string | undefined;
  children: React.ReactNode;
};

/**
 * Hover/focus tooltip rendered in a portal (fixed position) so it stays visible in
 * transparent Tauri/WebView2 windows where native `title` tooltips are often clipped or missing.
 */
export function Tooltip({ label, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, placement: "bottom" as "bottom" | "top" });
  const hostRef = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    if (!label?.trim()) return;
    const el = hostRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 8;
    const estH = 44;
    const roomBelow = window.innerHeight - r.bottom - gap;
    const placement = roomBelow < estH && r.top > estH + gap ? "top" : "bottom";
    const top = placement === "bottom" ? r.bottom + gap : r.top - gap;
    const left = Math.min(window.innerWidth - 12, Math.max(12, r.left + r.width / 2));
    setCoords({ top, left, placement });
    setVisible(true);
  }, [label]);

  const hide = useCallback(() => setVisible(false), []);

  if (!label?.trim()) {
    return <>{children}</>;
  }

  return (
    <>
      <span
        ref={hostRef}
        className="pa-tooltip-host"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {visible &&
        createPortal(
          <div
            className={`pa-tooltip-bubble pa-tooltip-bubble--${coords.placement}`}
            style={{ top: coords.top, left: coords.left }}
            role="tooltip"
          >
            {label}
          </div>,
          document.body
        )}
    </>
  );
}
