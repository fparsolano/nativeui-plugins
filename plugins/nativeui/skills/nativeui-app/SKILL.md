---
name: nativeui-app
description: >-
  Build a complete NativeUI app end-to-end from an app idea for the flagship mobile pair or any explicit
  target IDs. Use for multi-screen dynamic flows, responsive layouts, animated UI, forms, and dashboards. Handles
  PDFs, screenshots/images, Figma, source code, and HTML/CSS inputs. Runs the full pipeline: auth preflight,
  intake, plan screens, author one HTML/CSS document per screen, responsive audit, import to a NativeUI
  project, target-aware export, editor handoff, logic planning, local run, tests, and release preparation.
metadata:
  argument_hint: "[app idea]"
allowed-tools: "Bash(node <bin>/*) Bash(node <bin>/*) Read Write Edit Glob Grep"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui-app` inside the installed plugin source before running commands.



# Build a NativeUI app end-to-end

Headline flow: turn an **app idea** into a NativeUI project and selected app targets. Resolve the delivery
surface using `../nativeui/references/delivery-targets.md`: mobile defaults to the flagship SwiftUI + Compose
pair, web defaults to authored HTML + static build/hosting, and desktop defaults to Rust. “Static” here is a
render/deployment mode; it does not remove responsive layout, interactions, state, timelines, or PWA behavior. NativeUI generates the target UI
from one HTML/CSS document per screen.

Every generated app must be responsive and dynamic. Plan real width-dependent reflow plus the complete primary
journey: navigation, actionable controls, forms, data/list behavior, and relevant loading, empty,
validation/error, disabled, selected, retry, and success states. A responsive but interaction-free mockup is not complete.

`<bin>` below = `<bin>` (the plugin's toolchain scripts; pure Node 18+, no deps).

## 1. Hosted preflight
```bash
node <bin>/preflight.mjs
```
Verifies logged-in dev account **and** active subscription. On success it prints
`ok: <email>, subscription active`. On a non-zero exit, relay the remedy and stop hosted import/export/save;
local intake, authoring, capability lookup, doctor, planning, build, and test work may continue. No config is
needed. Remedies: not signed in →
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
If the app is prompt-based, based on PDF/image/Figma/source/URL input, or based on HTML that is plain, interaction-free, or
non-responsive, invoke `nativeui-design` before authoring. It creates `nativeui-design-guide.md`, asks any
needed responsiveness/portrait/landscape/UX questions, and defines the styling guide, layout system, animation
system, and responsive breakpoints for the HTML authoring step. Skip only for already-responsive HTML the user
asked to import exactly as-is.

## 3. Plan the screens
First resolve the delivery brief. For bare mobile, proceed with `auto` after naming the Rust and C# mobile
alternatives. For web, ask which of HTML/React/Vue/Angular/Astro and whether static or SSR; if the user accepts
defaults, use `web-html` + static. For desktop, use `rust-desktop` by default and offer `csharp-desktop`.
Also present Apple-native macOS SwiftUI, explaining that it requires a separately scoped/new `macos-swiftui`
exporter because none is registered; never substitute the iOS SwiftUI lane.

Ask only missing decisions, including OS/browser/width coverage, primary journey and states, parent sizing and
scroll ownership, backend/auth/data, and hosting/distribution. Then list each screen and its key components.
Confirm responsive behavior, dynamic journeys/states, animation, and backend needs. Pick stable, letter-first screen ids (used as navigation targets
and file basenames), e.g. `home`, `details`, `settings`.

For data-backed list sections, plan them as concrete HTML rows first, then after import add NativeUI repeater
metadata plus a `dataAdapters[]` entry when the product needs a reusable preview template. The adapter should
point at the registered API/database library item, map source fields into `{{item.*}}`, and carry non-secret
  sample rows. Live data requires equivalent behavior through every selected target's manifest-declared
  data/action seam, including web `data-adapters` where applicable.

## 4. Author one HTML/CSS document per screen
Follow `<this-skill>/../nativeui/references/authoring-rules.md` exactly. Write each screen as a complete
standalone HTML document and save it as `<screen-id>.html`. Core rules:
- **Plain HTML/CSS only** — embedded `<style>` + inline `style`. NO `<script>` or external/CDN stylesheets.
  Arbitrary `data-*` attributes are stripped; the reserved portable `data-nui-*` semantics documented by
  `authoring-rules.md` remain available for supported authored behavior.
- **Content-first, parent-constrained layout.** Keep `body`/root at
  `width:100%; min-width:0; min-height:100vh`. Give each major region an owning parent, fill/grow/shrink rules,
  min/max bounds, explicit scroll ownership, and paired pinned anchors. Validate product- and target-derived
  compact/medium/expanded snapshots; add breakpoints only where content or interaction requires reflow.
- **Intrinsic sizing handles the continuous range; content-required CSS `@media` reflow becomes NativeUI
  smart divisions** that re-resolve per device width on device.
- **Animations = `@keyframes` + `animation`** → become the NativeUI on-device timeline.
- **Stable, letter-first `id`** on every interactive/named element (`id="login_button"`, never digit-first) so
  every selected target receives deterministic typed/semantic control identity.
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
`calc()`/`clamp()`, flex/grid). The legacy `--allow-static` audit option cannot bypass this requirement and is
unrelated to static web build/hosting mode.

Audit the journey and dynamic states before import:
```bash
node <bin>/nui-flow-audit.mjs home.html details.html settings.html
```
Fix missing interactions/navigation, dead controls, and incomplete form/data/list state coverage.
Report any audit failure as a project-readiness blocker, not as a missing feature in the selected delivery lane:
name the missing state, confirm the selected lane supports it, and re-audit after correcting the source.

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
node <bin>/nui-flow-audit.mjs project.json
```

## 7. Export selected targets
```bash
node <bin>/nui-capabilities.mjs matrix --human
node <bin>/nui-export.mjs project.json --target auto -o ./native-out
```
Use repeated `--target`, groups, or `--all-targets` for explicit Rust, C#, legacy mobile, or web/PWA output.
Every archive contains the ownership/toolchain/release manifest and protects its durable logic seam.

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
List every selected target, output directory, manifest status, stage ID, local run result, missing prerequisite,
and beta/release gate. Offer `nui-run --target ...` for available hosts and `nui-release plan` for packaging.
Use **nativeui-connect** for logic, **nativeui-architect** then **nativeui-backend** for a new server, and
**nativeui-update** for later one-screen changes.

## Notes
- Re-export is merge-aware: generated files refresh and every declared durable seam is preserved.
- Verify the canonical UI corpus for each selected target. Do not infer parity from another lane.
