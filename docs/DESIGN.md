# Road to Ironman — design system ("calm endurance", 2026-11 rebrand)

The source of truth for how the app looks and is navigated. Tokens live in `src/ui/theme.ts`;
components use them via `useTheme()` and the `src/ui` primitives. Never hardcode a colour in a
screen or feature component (charts may use `sportColor`/`intensityColor`/`complianceColor`).

## 1. Brand

- **Personality:** a calm, competent coach. Professional, warm, quiet confidence — not a race
  bib. The old identity (hi-vis lime `#D4FF3A`, condensed heavy italics, slanted "speed
  stripes", skewed wordmark) is retired: no lime, no skew transforms, no italic display type,
  no decorative slashes/stripes.
- **Wordmark:** "Road to Ironman" set in Inter Bold, sentence case, tight tracking (−0.8 at
  30 pt). The mark is a road converging to a horizon with a rising sun (app icon,
  `assets/brand/`). Where the brand appears in-app (sign-in, onboarding welcome) use the mark +
  wordmark on a navy panel, generous whitespace, no stripes.
- **Voice (UI copy, Spanish of Spain):** short, direct, second person ("tú"), no exclamation
  overload, no ALL-CAPS sentences. Titles in sentence case.

## 2. Colour (semantic tokens — `colors.*`)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `bg` | `#F6F5F1` | `#0E1116` | screen background |
| `surface` | `#FFFFFF` | `#171C23` | cards, sheets |
| `surfaceAlt` | `#EFEEE9` | `#1E242C` | inset wells, segmented track, icon tiles |
| `surfacePressed` | `#E6E4DD` | `#262D37` | pressed state of neutral surfaces |
| `border` / `borderStrong` | `#E3E1DA` / `#C9C6BC` | `#29313B` / `#3A4350` | hairlines / inputs |
| `text` / `textMuted` / `textFaint` | ink / `#555D6B` / `#8A909B` | `#ECEFF3` / `#A2AAB5` / `#6E7783` | `textFaint` only for decoration or ≥18 pt |
| `accent` / `accentPressed` / `onAccent` | navy `#1F3A68` / `#172C50` / white | sky `#A9C1EE` / `#93AEE3` / `#0E1A2E` | primary button fill, selected chip, active toggle |
| `accentInk` | `#2A4E8C` | `#A9C1EE` | brand-coloured text and icons (links, "hoy", active tab) |
| `accentSoft` / `onAccentSoft` | `#E5EBF5` / navy | `#1B2638` / `#C9D8F5` | highlighted surfaces (today's card, "juntos" slots, selection bg, icon tiles of brand items) |
| `inverseBg` / `inverseText` | ink / paper | paper / night | rare high-emphasis chips (e.g. race countdown). Prefer `accentSoft` or `surface`. |
| `success` `warning` `danger` `info` | | | status only, always with an icon or text |

Rules:
- **One primary action per screen** uses `accent` fill. Everything else is `secondary`
  (surface + border), `ghost`, or a text link in `accentInk`.
- Highlight ≠ shout: "today", "together", "selected" use `accentSoft` backgrounds with
  `onAccentSoft`/`accentInk` content — never a saturated fill behind large areas.
- Sports keep their hue (`theme.sport(s)`): swim blue, bike violet, run teal, brick plum,
  strength slate, mobility periwinkle, other rose. Use `base` for small marks (rails, dots, icons,
  chart series) and `tint` for soft backgrounds. Never as large saturated fills.
- Green/yellow/orange/red are reserved for compliance/status and must be paired with an icon.
- Contrast: body text ≥ 4.5:1, secondary text ≥ 3:1, in **both** schemes. Check dark mode
  separately — don't assume.
- Gradients: none in UI chrome. Shadows: only `Card variant="raised"` in light mode
  (0/2/10, `colors.shadow`). Dark mode separates with surface steps + hairlines.

## 3. Typography (Inter — `type.*` via `<Text variant>`)

| Variant | Size/line | Weight | Use |
| --- | --- | --- | --- |
| `hero` | 40/46, −1.2 | Bold | one big number or the sign-in wordmark |
| `display` | 30/36, −0.8 | Bold | tab screen titles (`Screen title`) |
| `title` | 22/28, −0.4 | Bold | card titles, sheet titles |
| `heading` | 17/22, −0.2 | SemiBold | section headers, row titles |
| `body` / `bodyStrong` | 16/23 | Regular / SemiBold | text |
| `callout` | 15/21 | Medium | secondary rows |
| `caption` | 13/18 | Medium | meta, helper text |
| `overline` | 12/16, +0.6, UPPERCASE | SemiBold | small labels above titles; use sparingly (≤ 1 per card) and in `textMuted` |
| `metric` / `metricSmall` | 30/36 · 20/26 | SemiBold, tabular | numbers (durations, TSS, km, days) |

- `fonts.*` keys: `display`, `displaySemibold`, `numeric`, `body`, `bodyMedium`, `bodySemibold`,
  `bodyBold`. No italic, no condensed.
- Section headers are `heading` in `text` (sentence case), not uppercase overlines.
- Numbers always `metric*` (tabular) so they don't jump.
- Respect Dynamic Type (`maxFontSizeMultiplier` 1.4 is set in `Text`); prefer wrapping over
  truncation.

## 4. Shape, spacing, elevation

- Spacing: 4-pt scale (`space.*`). Screen gutter 16; gap between sections 24 (`xl`); inside a
  card 12–16; between related rows 8.
- Radius: `sm 8` small chips/tags, `md 12` buttons/inputs/icon tiles, `lg 16` cards, `xl 22`
  sheets/hero panels, `pill` only for tags, avatars and segmented thumbs.
- Buttons: height 52 (`lg`), 48 (`md`), 36 (`sm`); radius `md`; label `bodyStrong`. Touch
  targets ≥ 44×44 (use `hitSlop`).
- Cards: `surface` + hairline `border`, radius 16, padding 16. Don't nest bordered cards inside
  cards; inside a card use `surfaceAlt` wells or dividers.
- Icon tiles in list rows: 32×32, radius 10, `surfaceAlt` bg + `textMuted` glyph (brand items:
  `accentSoft` + `onAccentSoft`; sports: `sport.tint` + `sport.base`).
- Icons: SF Symbols via `<Icon>` only (no emoji as icons). Sizes 16 / 20 / 24 (`iconSize`).

## 5. Motion and feedback

- 150–240 ms, ease-out in / faster out; spring for press. Press feedback: `surfacePressed` or
  opacity 0.9 + scale 0.98 — never layout-shifting.
- Haptics: `haptics.tap()` on taps that change state, `impact` on long-press, success on
  completion. Respect reduced motion (`Appear` already does).
- Loading > 300 ms: skeletons or `Loading`; errors: `ErrorNotice` with retry.

## 6. Navigation (information architecture)

Five tabs (`src/app/(tabs)`), each a top-level destination with its own large title:

1. **Hoy** — what matters today: banners (invites, proposals), morning report, today's
   session(s), quick actions (check-in, imprevisto, comida), meals, tomorrow, today's quedadas.
2. **Plan** — the week: switcher, phase, totals, planning tools, 7 days.
3. **Juntos** — friends: actionable first (requests, upcoming + open quedadas), then the
   per-friend compare (Huecos, Oportunidades, volume), shared races, feed. Bell → Avisos inbox.
4. **Progreso** — form (PMC), volume & compliance, recovery, nutrition, races.
5. **Tú** — settings hub only: identity header, then grouped lists (Entrenamiento, Tu coach,
   Conexiones, Preferencias incl. **Apariencia** light/dark/automatic, Privacidad, Cuenta).

The coach accessory (iOS 26 tab bar accessory, inline card elsewhere) is the single way to talk
to the coach. Tab screens use `<Screen title=… overline=… headerRight=…>` +
`useTabBottomPadding()`; pushed screens use the native header (`Screen inSheet`). Switching to a
tab from code uses `router.navigate('/together')` / `dismissTo`, never `push` (that would stack a
second tab navigator). Every screen must be reachable from the UI — no orphan routes.

Naming: **Avisos** = the inbox (`/notifications`); **Notificaciones** = the preferences screen
(`/settings/notifications`).

## 7. Light / dark / automatic

`src/ui/appearance.ts` stores `system | light | dark` on the device and pushes it to
`Appearance.setColorScheme` so native chrome follows. `useTheme()` resolves it. The picker is
`features/settings/AppearancePicker.tsx` (Tú → Preferencias). Both schemes are designed, not
inverted: dark uses lighter, desaturated accents (`sky`) and surface steps instead of shadows.
