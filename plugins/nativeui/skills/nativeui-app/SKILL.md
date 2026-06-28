---
name: nativeui-app
description: >-
  Build a complete native iOS + Android app end-to-end with NativeUI from an app idea. Use when the user
  asks to build/make/create/generate/prototype a mobile app or a set of screens — multi-screen flows,
  responsive layouts, animated UI, forms, dashboards — and wants real native iOS + Android output. Handles
  PDFs, screenshots/images, Figma, source code, and HTML/CSS inputs. Runs the full pipeline: auth preflight,
  intake, plan screens, author one HTML/CSS document per screen, responsive audit, import to a NativeUI
  project, and export native Android + iOS projects.
metadata:
  argument_hint: "[app idea]"
allowed-tools: "Bash(node <bin>/*) Bash(node <bin>/*) Read Write Edit Glob Grep"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui-app` inside the installed plugin source before running commands.



# Build a NativeUI app end-to-end

Headline flow: turn an **app idea** into native iOS + Android projects. You author plain HTML/CSS (one
document per screen), import it to a `project.json`, and export both platforms. You never write
SwiftUI/UIKit/Compose/XML by hand — NativeUI generates the native UI.

`<bin>` below = `<bin>` (the plugin's toolchain scripts; pure Node 18+, no deps).

## 1. Preflight — ALWAYS FIRST, stop on failure
```bash
node <bin>/preflight.mjs
```
Verifies logged-in dev account **and** active subscription. On success it prints
`ok: <email>, subscription active`. On any non-zero exit, relay the printed remedy verbatim and **STOP** —
do not author or export. No config is needed (PUBLIC dev defaults are baked in). Remedies: not signed in →
`node <bin>/login.mjs` (browser SSO); no subscription → activate billing, re-run. (A config error is rare —
only if a `~/.nativeui/config.json` / `NATIVEUI_*` override for another environment blanked a field.)

If a tenant policy or approval reviewer denies upload to `dev.nativeui.com` as external disclosure, **STOP** and
do not retry. Present the admin policy kit (`admin/codex-requirements.nativeui.example.toml` in the Codex plugin
package) or the approved internal/self-host export fallback (`"exportAuthMode": "none"`).

## 2. Intake source material when present
If the request includes PDFs, screenshots/images, Figma links or JSON, existing HTML/CSS, source files/folders,
or URLs, run intake before planning:
```bash
node <bin>/nui-intake.mjs <input...> -o nativeui-intake.json
```
For prompt-only app ideas with concrete requirements, capture the prompt:
```bash
node <bin>/nui-intake.mjs --prompt "<app idea>" -o nativeui-intake.json
```
Use the bundle's assets, breakpoints, source summaries, confidence, and `gaps[]`; do not guess through gaps.

## 2b. Design direction
If the app is prompt-based, based on PDF/image/Figma/source/URL input, or based on HTML that is plain/static or
non-responsive, invoke `nativeui-design` before authoring. It creates `nativeui-design-guide.md`, asks any
needed responsiveness/portrait/landscape/UX questions, and defines the styling guide, layout system, animation
system, and responsive breakpoints for the HTML authoring step. Skip only for already-responsive HTML the user
asked to import exactly as-is.

## 3. Plan the screens
From the idea, list each screen and its key components. Default target is **both iOS + Android**. Confirm any
responsiveness, animation, or backend needs. Pick stable, letter-first screen ids (used as navigation targets
and file basenames), e.g. `home`, `details`, `settings`.

For data-backed list sections, plan them as concrete HTML rows first, then after import add NativeUI repeater
metadata plus a `dataAdapters[]` entry when the product needs a reusable preview template. The adapter should
point at the registered API/database library item, map source fields into `{{item.*}}`, and carry non-secret
sample rows. Live data still requires matching Android + iOS connector behavior.

## 4. Author one HTML/CSS document per screen
Follow `<this-skill>/../nativeui/references/authoring-rules.md` exactly. Write each screen as a complete
standalone HTML document and save it as `<screen-id>.html`. Core rules:
- **Plain HTML/CSS only** — embedded `<style>` + inline `style`. NO `<script>`, NO external/CDN stylesheets,
  NO `data-*` attributes (these abort or are stripped on import).
- **Mobile-first, 412 × 915 stage.** Author for 412px width first; `body { width: 412px; height: 915px; }`.
- **Responsiveness = CSS `@media` width breakpoints** → become NativeUI smart divisions that re-resolve per
  device width on device.
- **Animations = `@keyframes` + `animation`** → become the NativeUI on-device timeline.
- **Stable, letter-first `id`** on every interactive/named element (`id="login_button"`, never digit-first) so
  the backend gets a typed accessor on both platforms.
- **Multi-page** = one HTML doc per screen; link screens by destination title/name slug (`#trip-detail`) or
  page index (`#page2`), not by an element id.
- `<title>` becomes the screen name.

Copy from `<this-skill>/../nativeui/examples/` as templates. If `nativeui-design-guide.md` exists, treat
it as the styling guide for layout, colors, typography, animation, responsive behavior, portrait/landscape
intent, and UX states. If the user gave a visual direction, honor it; otherwise produce a clean, intentional
design.

## 5. Responsive audit before import
Generated app flows must have a responsive path:
```bash
node <bin>/nui-responsive-audit.mjs home.html details.html settings.html
```
Fix failures by adding real responsive structure (`@media`, `%`, `fr`, `flex-grow`, viewport units,
`calc()`/`clamp()`, flex/grid). Pass `--allow-static` only when the user explicitly requested a fixed design.

## 6. Import → `project.json`
List the screen files in screen order; each page name comes from the file basename:
```bash
node <bin>/nui-import.mjs home.html details.html settings.html -o project.json
```
If the service returns `errors[]`, the script prints them and **writes nothing**. FIX the offending HTML/CSS
and re-import — never hand-edit around an import error, and never edit `project.json` to paper over one.

After import, the project may also be audited:
```bash
node <bin>/nui-responsive-audit.mjs project.json
```

## 7. Export native iOS + Android (BOTH)
```bash
node <bin>/nui-export.mjs project.json --platform android -o ./android-out
node <bin>/nui-export.mjs project.json --platform ios     -o ./ios-out
```
Each writes `<outdir>/<platform>-export.zip` and unzips it in place when `unzip` is present.

## 8. Final review
Before handoff, run the final reviewer:
```bash
node <bin>/nui-final-review.mjs \
	  --project project.json \
	  --html home.html details.html settings.html \
	  --architecture nativeui-architecture.md \
	  --instructions user-instructions.md \
	  --android-dir ./android-out \
  --ios-dir ./ios-out \
  --human
```
Include `--intake nativeui-intake.json` if intake ran and `--architecture nativeui-architecture.md` when backend
functionality exists. Pass the latest user requirements as inline text or a path/`@path` file. Fix non-zero errors
before claiming the app is done.

## 9. Hand off
Tell the user where the two projects are (`./android-out`, `./ios-out`), how to open them (Android Studio /
Xcode), and the screen list with their stage ids. **Offer to run it locally**: `node <bin>/nui-run.mjs
project.json --platform both` builds + launches the real PROD app (clean export — animations, responsive
divisions, effects, and events/nav all work) on the local emulator + simulator — see the **nativeui-run**
skill. If they want behavior wired (login, fetch, save, taps), point them at the **nativeui-connect** skill,
which plans durable `*BackendConnector.*` classes and keeps `NuiBackend.*` as a thin delegator. If they need a
new backend or deployment shape, start with **nativeui-architect**, then continue to **nativeui-backend** after
approval. To change a single screen later, use **nativeui-update**.

## Notes
- Re-running import/export is round-trip-safe; re-export regenerates UI around any untouched `NuiBackend.*`.
- Verify parity (editor == web == both natives) when in the NativeUI repo via the parity harness; the goal is
  always pixel-faithful WYSIWYG across all surfaces.
