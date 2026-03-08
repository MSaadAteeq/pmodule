# UI/UX Improvements — Parakeet AI Desktop

This document summarizes the design system and UI/UX changes applied across the application. **No app logic or behavior was changed**; only styling, layout, and visual consistency were improved.

---

## 1. Design System (Tokens)

**File: `src/index.css`**

- **Spacing (8px grid):** `--space-1` (4px) through `--space-16` (64px) for consistent margins and padding.
- **Colors:** Semantic palette:
  - `--bg-base`, `--bg-raised`, `--bg-overlay`, `--bg-input` for surfaces
  - `--border-subtle`, `--border-default`, `--border-strong` for borders
  - `--text-primary`, `--text-secondary`, `--text-muted` for type hierarchy
  - `--primary` / `--primary-hover` (emerald), `--danger`, `--info`, success/error text
- **Typography:** `--font-sans` (Inter), `--font-mono`, scale from `--text-xs` to `--text-3xl`, font weights and line heights.
- **Radii:** `--radius-sm` (6px) to `--radius-2xl` (16px).
- **Shadows:** `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-modal` for elevation.
- **Transitions:** `--transition-fast`, `--transition-normal`, `--ease-out` for consistent motion.

**Accessibility:** `:focus-visible` styles for keyboard users (outline on buttons, inputs, select).

---

## 2. App Shell & Layout

**File: `src/App.css`**

- **Title bar:** Slightly taller (36px), clearer hierarchy; window controls use the same transition easing.
- **Header:** Uses design tokens; heading uses bolder weight and letter-spacing; badges and actions use the spacing grid.
- **Main content:** Max-width 620px with consistent `--space-8` padding; practice card uses `--radius-2xl` and light shadow.
- **Visual hierarchy:** Section titles (e.g. practice card h2), subtitles, and body text use the typography scale and color tokens.

---

## 3. Buttons & Inputs

- **Buttons:** `.btn` uses tokens for padding, radius, and font; `.btn:active` scale(0.98) for feedback; disabled state with reduced opacity; ghost and primary variants aligned with the palette.
- **Inputs:** `.input` and `.controls-type-input` use border, focus ring (3px primary-muted), and placeholder color from tokens; transitions on border and box-shadow.

---

## 4. Cards, Modals & Panels

- **Cards (practice, suggestion, answer):** Background and border from tokens; consistent radius and padding; answer box code blocks use `--font-mono`.
- **Modal overlay:** Backdrop blur and a short fade-in animation.
- **Modal panel:** Scale + translateY entrance animation; `--shadow-modal`; border and radius from tokens.
- **Position picker:** Overlay uses blur; zones use primary-muted and dashed border; hover scale for feedback.

---

## 5. Listening Mode & AI Interface

- **Liste bar:** Uses `--bg-raised` and `--border-subtle`; type input and buttons aligned to the spacing grid.
- **Answer area:** `.answer-content-visible` keeps scroll and typography; headings and code blocks use tokens; memory-saved badge uses primary-muted and border.
- **Center boxes:** Max-width and margins use spacing tokens for consistency with the rest of the app.

---

## 6. Auth Screen

**File: `src/components/AuthScreen.css`**

- Card uses `--bg-overlay`, `--radius-2xl`, and `--shadow-lg`.
- Form spacing with `--space-4` gap; error/success messages in small padded blocks with semantic colors.
- Code block (e.g. `npm run tauri dev`) uses `--font-mono` and border from tokens.

---

## 7. Upgrade Modal

**File: `src/components/UpgradeModal.css`**

- Modal width and copy use tokens; coupon row uses spacing grid.
- Pricing cards use hover state and transition; featured plan uses primary-muted and border; badge uses primary and inverse text.

---

## 8. Admin Panel

**File: `src/components/AdminPanel.css`**

- Section headings use uppercase and letter-spacing for hierarchy.
- Lists use `--bg-raised` and `--border-default`; list items have a subtle hover background.
- Confirm modal uses the same overlay/modal animation and shadow as the main modals; danger button in confirm uses muted red style.

---

## 9. Typography & Fonts

**File: `index.html`**

- **Inter** is loaded from Google Fonts (weights 400, 500, 600, 700) and set as `--font-sans` for a clean, product-style look across the app.

---

## 10. What Stayed the Same

- All React component structure and props.
- All class names used in `App.tsx` and in AuthScreen, UpgradeModal, AdminPanel.
- All behavior: auth, listening, transcript submit, modals, position picker, click-through mode.
- Tauri title bar drag region and window controls behavior.

---

## Summary

The app now has a **single source of truth** for spacing, color, type, and motion in `index.css`. All updated styles use these tokens, giving:

- **Consistent visual hierarchy** (surfaces, borders, text levels).
- **Unified spacing** (8px-based grid).
- **Clear, accessible focus states** and subtle **micro-interactions** (hover, active, modal open).
- **A more product-like look** (Inter, emerald primary, dark surfaces) similar to modern AI/SaaS tools, without changing any logic.
