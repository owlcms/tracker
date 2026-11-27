---
name: scoreboard-design
description: "Use when: designing, styling, or refining Tracker scoreboards, attempt boards, team boards, or broadcast/OBS video overlays — color selection, contrast, typography, tabular-nums, anti-clutter layout, and motion hygiene. Keywords: scoreboard design, color palette, contrast, typography, tabular-nums, CSS, Svelte, GSAP, broadcast graphics, OBS overlay, lower third, LED wall."
license: Apache-2.0
metadata:
  adapted_from: "google-gemini/demolab skills/gemini-frontend-design (Apache-2.0)"
---

# Scoreboard Design (OWLCMS Tracker)

Adapted from `google-gemini/demolab`'s `gemini-frontend-design` skill (Apache-2.0),
keeping only the visual-design, color, typography, layout, and motion rules that apply to
competition scoreboards, attempt boards, and broadcast/OBS overlays.

## 1. Color Selection & Contrast

- **Honor explicit federation/event colors first**: When a user or federation specifies
  brand colors (or URL query-parameter color options in `config.js`), derive the palette
  from those colors cleanly.
- **Avoid generic AI defaults**: Do not default automatically to warm beige/terracotta or
  dark-slate + neon-purple glow. When the palette is open, choose colors suited to the
  display medium: deep ink, marine, forest, or charcoal darks for venue LED walls and dim
  halls; crisp high-contrast light surfaces for bright arenas; or bold chromatic
  color-blocking matched to the federation/event identity.
- **Tokenized palette + one accent**: Define clean CSS custom properties (respecting
  existing plugin variables or `src/app.css` where applicable) for:
  - primary surface and subtle secondary surface / row banding
  - primary text and muted metadata text (meeting WCAG AA `>= 4.5:1` contrast)
  - one deliberate brand/header accent
- **Reserve semantic colors for competition state**: Keep high-chroma status colors
  strictly for weightlifting meaning — good lift, fail/no lift, current lifter, next lifter,
  requested/pending attempt, referee/jury decisions, review warning, record attempt, and
  medal ranks. Do not reuse status colors for unrelated decoration.
- **OBS / broadcast overlays**: Keep overlay backgrounds genuinely transparent where
  required and ensure crisp figure-ground contrast on lower thirds, banners, and sidebars
  over live camera video without muddy full-screen dark scrims.

## 2. Typography & Numeric Stability

- **At most 2 font families**: Use either 1 versatile sans family across weights, or a
  deliberate 2-font pairing (e.g., condensed/display face for headers, weights, and timers
  plus a clean sans for athlete names and tables).
- **Use `tabular-nums`, never a 3rd monospace font**: Apply
  `font-variant-numeric: tabular-nums` to countdown timers, weights, start numbers, ranks,
  totals, Sinclair/Q-Points/GAMX scores, and team points so columns align and live timers
  never shift horizontally.
- **Strict size-step discipline**: Lock the board to at most 3–4 consistent font-size steps
  (for example: primary clock/attempt weight, athlete row text, column headers/secondary
  fields, compact auxiliary metadata). Differentiate hierarchy via **weight, font family,
  and color** instead of inventing arbitrary intermediate sizes.
- **Distance legibility**: Tighten display tracking slightly (`-0.02em` to `-0.05em`) only
  on oversized headers or attempt weights where it improves compactness; avoid tiny text
  that degrades on venue screens or 1080p streams.

## 3. Layout & Anti-Clutter Discipline

- **Live data immediately**: Scoreboards and broadcast graphics open directly into live
  competition data sized cleanly for their target canvas (`1920x1080` or the target LED
  wall aspect ratio) with zero marketing chrome and zero unintended scrollbars.
- **No decorative UI chrome**:
  - Do not add eyebrow kickers above titles, decorative non-interactive chips/badges/pills,
    decorative numbering (`01`, `02`), or fake `"LIVE"` telemetry dots.
  - Reserve bordered pills or strong color fills strictly for genuine competition state
    (start number box, good/fail attempts, current/next lifter highlight, record alerts,
    medal ranks, referee/jury decision lights).
- **No nested card-in-card cages**: Separate board sections (header, current athlete bar,
  table rows, team summaries, record strip) using whitespace, `1px` dividers, or subtle
  surface tint rather than bordered cards nested inside cards.
- **Display-only components**: Keep all sorting, filtering, grouping, and formatting logic
  in `helpers.data.js`; Svelte components only render pre-processed data and styling.

## 4. Motion & Transition Hygiene (CSS & GSAP)

- **Brisk, explicit transitions**: Keep UI/state updates quick (`140ms–240ms`, smooth
  ease-out such as `cubic-bezier(0.22, 1, 0.36, 1)` or GSAP `power2.out`/`power3.out`;
  never `ease-in` and never `transition: all`). Animate explicit properties (`transform`,
  `opacity`, `clip-path`, or specific color/background properties).
- **No distracting idle loops**: Avoid ambient bobbing, pulsing, or glow animations that
  pull attention away from the athlete or countdown clock.
- **Safe rest state & reduced motion**: Entrance and update animations must always settle
  at full visibility (never stuck at `opacity: 0`) and honor
  `@media (prefers-reduced-motion: reduce)`.

## 5. Pre-Delivery Visual Check

1. Audit styles and markup:
   - [ ] Palette uses CSS custom properties, avoids generic beige or dark-neon defaults
         unless requested, and maintains WCAG AA `>= 4.5:1` contrast.
   - [ ] Semantic competition colors are reserved for actual lift/rank/decision states.
   - [ ] At most 2 font families; `font-variant-numeric: tabular-nums` on all numbers and
         timers; at most 3–4 consistent font-size steps.
   - [ ] Zero decorative chips, eyebrow kickers, fake `"LIVE"` cues, or nested card-in-card
         borders.
   - [ ] Explicit animated properties only (no `transition: all`) and
         `prefers-reduced-motion` support.
2. Verify rendered output in a browser:
   - Run `npm run dev` (`http://localhost:8096`) and inspect the scoreboard at `1920x1080`
     (plus any target LED wall / broadcast aspect ratio).
   - Check for clipped athlete names or weights, unwanted row wrapping, horizontal/vertical
     overflow, and legibility across configured theme/overlay options.
