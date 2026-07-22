# Delivery targets and decision brief

Use this brief before screen planning, architecture, local run, or release whenever the requested delivery
surface is missing or ambiguous. `nativeui-targets.json` and `nui-capabilities matrix` remain the executable
source of truth.

## Question policy

- Infer decisions already answered by the prompt, source material, repository, or existing export manifest.
- Ask only missing choices that materially change the generated project, runtime, hosting, signing, or UX.
- Ask at most one to three short questions in a round. Put the recommended/default choice first and explain the
  consequence in one sentence. Do not re-ask answered questions.
- A bare `mobile`, `web`, or `desktop` request selects the default below. Name the alternatives once, but do
  not block progress when the user accepts the default or asks you to continue.
- Record inferred/defaulted answers as assumptions in the design guide or architecture record.
- Carry resolved answers forward between intake, design, architecture, and release. Consolidate overlapping
  questions into one round; a downstream skill must not ask the same brief again.

## Surface defaults and alternatives

### Mobile

`mobile`, `mobile-flagship`, and `auto` default to the stable flagship pair:
`ios-swiftui` + `android-compose`. It produces idiomatic native UI and accessibility for each OS and has the
strongest release gates. Confirm whether both iOS and Android are required only when the request could mean one
OS.
The literal word `mobile` is not ambiguous: state both OSes as the non-blocking assumption and continue unless
the user narrows it.

Offer these alternatives when the team or codebase makes them relevant:

| Choice | Targets | Best fit | Cost/tradeoff |
| --- | --- | --- | --- |
| Flagship native (default) | `ios-swiftui`, `android-compose` | App Store/Play delivery and strongest platform-native fidelity | Two generated host projects and durable action seams |
| Rust mobile | `rust-ios`, `rust-android` (`mobile-rust`) | Rust teams or a shared Rust runtime/action seam | Beta; Cargo plus Xcode/NDK/device toolchains |
| C# mobile | `csharp-ios`, `csharp-android` (`mobile-csharp`) | .NET teams and shared `AppActions.cs` behavior | Beta; .NET mobile workloads and platform signing |

UIKit and Android Views are legacy lanes and should be offered only when explicitly requested or required by an
existing codebase.

### Web

Ask for the lane and delivery mode when they are not implied. If the user has no preference, use
`web-html` + `static`.
Present the lane/mode choice once; if the user says to continue or does not care, proceed immediately with that
default rather than pausing the workflow repeatedly.

| Lane | Rendering | Best fit |
| --- | --- | --- |
| `web-html` (default) | Static build/hosting only; full client behavior | Dependency-free semantic HTML, plain CSS, ES modules, easiest CDN/PWA ownership |
| `web-react` | Static or Node SSR | React Router, strict TypeScript, hooks, and the broad React ecosystem |
| `web-vue` | Static or SSR | Nuxt file routes, Vue SFCs, `<script setup>`, and composables |
| `web-angular` | Static or SSR | Strict standalone Angular, signals, router/services, and structured enterprise teams |
| `web-astro` | Static or Node SSR | HTML-first pages, content/performance work, and islands only where interaction needs JavaScript |

Static is the default: complete prerendered pages, simple CDN/static hosting, offline PWA behavior, and fewer
operational dependencies. Choose SSR only when request-time HTML, personalization/auth, server data, or
server-rendered SEO is required and the chosen host supports the lane's Node/server runtime. Vanilla HTML does
not have an SSR mode.

`Static` describes the build and hosting mode, not a static mockup, fixed viewport, or reduced capability set.
Static builds retain responsive parent constraints and compile the same applicable navigation, state, forms,
lists, selection, timelines, offline behavior, and developer seams into client-side behavior.

All five lanes emit authored, routed projects. They compile navigation, local state, visibility, forms, lists,
selection, and timelines directly into native framework behavior. They do not ship iframes, `project.json`,
serialized NativeUI models, generic DOM binders, or runtime model interpreters. Durable extension seams are
`app-actions`, `data-adapters`, and `custom-components`; generated contracts are refreshed separately and a
contract-changing preserved implementation gets a `.new` candidate.

Treat each selected web manifest as an executable completeness contract. Every declared capability occurrence,
node kind, action, trigger, and timeline property needs an explicit disposition and an exact implementation
receipt in that lane. A missing receipt or required carrier is an export/review error; another lane, a canonical
HTML reference, or a shared planner declaration is not proof that the selected lane implemented it.

### Desktop

For every desktop request, present all three choices with their status:

- `rust-desktop` (`desktop`/`desktop-rust`) is the default: beta, cross-platform macOS/Linux/Windows output with
  a small shared Rust-native runtime and strong performance.
- `csharp-desktop` (`desktop-csharp`) is the available .NET alternative: beta, cross-platform, and suited to
  teams that prefer self-contained C# publishes and .NET tooling.
- macOS SwiftUI is the platform-specific alternative for teams that require Apple-native desktop UI, but it is
  not yet a registered NativeUI target. It requires a separately scoped/new `macos-swiftui` exporter before
  NativeUI can produce it; `ios-swiftui` produces iOS/iPadOS output and must never be substituted.

Ask whether the user wants that new macOS-only exporter only after explaining the distinction. Do not silently
pivot from app delivery into adding a platform exporter without explicit authorization.

## Responsive and dynamic defaults

Responsiveness is the default for every surface, not an opt-in. The selected product and targets determine a
compact/medium/expanded validation matrix, including relevant orientation and input modes; they never establish
a fixed authoring size. Choose exact test snapshots from supported target bounds and actual content needs, and
define a structural breakpoint only where content or interaction requires reflow.

For each major page region record:

- the parent that owns its width and height;
- fill/grow/shrink behavior and intrinsic sizing;
- minimum and maximum bounds;
- the single scroll owner for each axis;
- paired anchors for pinned chrome and safe-area behavior;
- the structural change at each relevant breakpoint.

Keep `body` and the page root fluid (`width:100%`, `min-width:0`, and an appropriate minimum viewport height).
Use flex/grid, percentages, `fr`, `minmax(0,1fr)`, growth/shrink, min/max constraints, and paired anchors. Never
simulate responsiveness by scaling or centering a fixed canvas.

Dynamic flow is also required. Identify the primary journey, navigation and back/retry paths, control triggers,
state mutations, forms, repeaters/data, and relevant loading, empty, validation/error, disabled, selected,
success, offline, and retry states before authoring.

## Questions by phase

Ask only what is unresolved.

### Walkthrough and intake

- Who is the audience and what is the primary job or journey?
- Which delivery surface(s), OS/browser ranges, orientations, and input modes matter?
- Which target family/lane should be used; for framework web, static or SSR?
- Which source is authoritative for copy, visual fidelity, routes, and existing IDs?
- Are offline use, accessibility conformance, localization, or reduced motion required?

### Design

- Which screens, branches, and completion/retry paths are required?
- At which measured content or interaction thresholds does structure change, and what happens in relevant
  orientation or expanded-layout validation snapshots?
- For every major region, which parent owns sizing, scrolling, and pinned edges?
- Which loading/empty/error/success/offline and form/list states must be visible?
- What brand/tone, density, motion level, and must-preserve landmarks or IDs apply?

### Architecture

- Which exact client target IDs and web render mode are approved?
- What API, database, auth/session, storage, job, webhook, or server-only secret behavior is required?
- What owns request-time rendering, personalization, API origin/proxying, CORS, cookies, and cache policy?
- Where do frontend and backend live in the repository, and how do local/dev/preview/prod environments differ?
- Which provider/runtime, region, domain/base path, health check, observability, and rollback strategy apply?

### Deployment and release

- Which targets, version/environment, OS/CPU/browser ranges, and artifacts are in scope?
- For web: lane, static/SSR, provider/runtime, route fallback/base path, domain/TLS, environment variables,
  preview versus production, offline fallback, and service-worker update policy?
- For mobile: bundle/application IDs, stores, signing accounts, device matrix, phased rollout, and ownership?
- For desktop: OS/architectures, package format, signing/notarization, update channel, and direct/store delivery?
- Who owns credentials and external-state approval? Show the plan and artifacts before deploying, uploading,
  notarizing, or submitting.
