# vite-evergreen-attrs — Tier 2 locator fallback (build-time test-attr injection)

A Vite plugin that injects a **stable** `data-evergreen="<stable-id>"` attribute, at
dev/build time, onto **interactive elements that lack an accessible name** — role-less
clickable `<div>`/`<span>`s, icon-only buttons, and other `onClick` elements with no
text or `aria-label`. It gives the QA Evergreen platform something deterministic to grab
when an owned app can't (yet) expose proper ARIA.

This is **Tier 2** of the locator fallback strategy. The platform's primary contract is
to locate by **role + accessible name** (`getByRole` / `getByLabel`); see
[`AGENTS.md`](../../AGENTS.md) golden rule #2. This plugin is a *fallback*, not a
replacement — read the caveats at the bottom before reaching for it.

---

## What it does

For every JSX file (`.jsx` / `.tsx`) in your app it:

1. Finds **interactive** intrinsic elements — anything with an `onClick`, plus native
   `<button>` / `<a>` (toggleable via `includeNativeInteractive`).
2. **Skips** elements that already have an accessible name or explicit label:
   `aria-label`, `aria-labelledby`, `title`, `alt`, `placeholder`, or meaningful text
   children (e.g. `<button>Initiate Transfer</button>` is left alone — role+name already
   works on it).
3. For the rest, appends `data-evergreen="<stable-id>"`. The attribute is **purely
   additive**: it changes no role, no accessible name, and no existing attribute.

A lone **glyph** (e.g. `☰`, `✕`) is treated as an *icon*, not a real accessible name, so
such elements are still tagged (and the glyph becomes a readable hint — see below).

## The component-identity keying rule (the important part)

The id is derived from **component identity**, never from raw source line numbers
(line-based ids break on every edit — reformatting, an added import, moving a block — which
would defeat the entire purpose of a *stable* locator).

```
<ComponentName>:<hint>          e.g.  DashboardPage:menu-toggle
<ComponentName>:<hint>#<n>      when several siblings share a hint (n = 1, 2, …)
```

- **`<ComponentName>`** — the enclosing React component (named `function`/arrow/`class`,
  preferring an uppercase name). Falls back to the file basename.
- **`<hint>`** — the first stable signal found, in priority order:
  1. first `className` token — `"menu-toggle secondary"` → `menu-toggle`
  2. icon glyph / static text child — `☰` → `menu`, `✕` → `close` (mapped), else
     `icon-<codepoint>`
  3. the tag name — `div`
- **`#<n>`** — a per-component occurrence counter that disambiguates siblings that hash to
  the same `Component:hint`. It counts occurrences within the component, **not** line
  numbers, so it only shifts if you add/remove a *matching sibling* in that component.

Because nothing in the id comes from a line number, edits that merely move code keep the
id constant. (Proven on FundFlow: adding imports/comments above the component leaves
`DashboardPage:menu-toggle` unchanged.)

## How to add it to a Vite config

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import evergreenAttrs from '../path/to/toolkit/build-plugins/vite-evergreen-attrs.mjs';

export default defineConfig({
  // Put it BEFORE @vitejs/plugin-react — it uses enforce:'pre' so it transforms
  // the JSX before React compiles it away.
  plugins: [evergreenAttrs(), react()],
});
```

Options:

| option                     | default | meaning                                                        |
| -------------------------- | ------- | -------------------------------------------------------------- |
| `includeNativeInteractive` | `true`  | also tag icon-only `<button>`/`<a>` (text ones are skipped)    |
| `debug`                    | `false` | log every injected `data-evergreen` id to the console         |

Then locate via the attribute as a Tier-2 fallback, e.g. Playwright:
`page.locator('[data-evergreen="DashboardPage:menu-toggle"]')`.

## Dependencies

Uses `@babel/{parser,traverse,generator,types}` for a real JSX/AST transform. These are
**already present transitively** via `@vitejs/plugin-react`, so the plugin adds **no new
dependency** to your `package.json`. They are resolved against the *target app's*
`node_modules` (anchored at Vite's `config.root`). If they are ever genuinely absent, the
plugin **degrades to a no-op with a warning** rather than breaking your build.

## Verified on FundFlow (the steel-thread React app)

The app deliberately ships an a11y defect — a role-less `☰` menu toggle:

```tsx
// before
<div className="menu-toggle" onClick={() => setMenuOpen(v => !v)}>☰</div>
```

After wiring the plugin and running `vite build`, the built bundle contains exactly one
injected attribute:

```jsonc
"data-evergreen":"DashboardPage:menu-toggle"   // the ☰ toggle, now locatable
```

The text buttons (`Initiate Transfer`, `Sign out`, etc.) are **not** tagged — they already
have accessible names, so the existing role+name locators keep working unchanged. The
injection is additive: the `menu-toggle` class and the `☰` glyph are untouched.

## Honest caveats and limits

- **Owned apps only.** This requires control of the *build*. It does nothing for
  third-party / vendor apps you don't compile — for those, the platform must rely on the
  discovered live a11y tree.
- **Prefer fixing a11y over injecting parallel testids.** A `data-evergreen` attribute is a
  crutch: it makes a broken element *locatable* but still inaccessible to real assistive
  tech. The right long-term fix is to give the element a real `role` + accessible name
  (that's **Tier 4 — the auto-aria PR**). Treat Tier 2 as a stopgap while that lands, not a
  destination. Don't let parallel testids become an excuse to never fix the ARIA.
- **What it catches:** intrinsic (`lowercase`) JSX elements with an `onClick` (or native
  `<button>`/`<a>`) that have no accessible name — including icon-only buttons and static
  glyph children.
- **What it misses (by design or limitation):**
  - **Custom components** (`<MyButton onClick=…>`): a custom component may not forward
    unknown DOM props, and we can't see its accessible name, so we skip it. Tag the
    intrinsic element *inside* the component instead.
  - Elements whose accessible name comes from a **dynamic expression** child
    (`<div onClick=…>{label}</div>`): we can't statically read the text, so we
    conservatively skip (we won't claim a name we can't verify, but we also won't tag it —
    if such an element is genuinely unlabeled at runtime, add an explicit hint via
    `className`/`aria-label`).
  - Handlers attached **imperatively** (`ref` + `addEventListener`) — not visible in JSX.
  - Spread props (`{...props}`) that *might* carry `onClick`/`aria-label` — not analyzed.
  - Non-JSX templates (`.vue`, `.svelte`, plain HTML). This plugin is JSX-only.
- **Stability boundary:** the id is invariant to line moves, but it **will change** if you
  rename the component, change the first `className` token / glyph used as the hint, or
  add/remove a matching sibling (which shifts the `#<n>` counter). Those are *semantic*
  edits, which is the intended trade-off.
