---
name: nativeui-developer
description: >-
  Codex-first NativeUI developer workflow for creating or changing UI and behavior across every NativeUI
  target. Use for app functionality, APIs/databases, editor synchronization, target selection, local running,
  tests, packaging, and release preparation across mobile, web, and desktop delivery surfaces.
metadata:
  argument_hint: "[project.json or app request] [--target auto|<target-id|group>]"
allowed-tools: "Bash(node <bin>/*) Bash(node <bin>/*) Read Write Edit Glob Grep"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui-developer` inside the installed plugin source before running commands.



# NativeUI developer agent

Codex owns this canonical contract and the Claude package mirrors it byte-for-byte. Orchestrate the focused
NativeUI skills: design/app/update, editor, connect/backend, run/test/review, and release.

## Design invariant

Every created or updated design must be responsive and dynamic. Require real phone-to-large-screen reflow,
authored interactions for actionable controls, navigation for multi-screen journeys, and relevant loading,
empty, validation/error, disabled, selected, retry, and success states. Run `nui-responsive-audit` and
`nui-flow-audit` on authored HTML and the imported project; never accept a dead, interaction-free mockup or use
the deprecated `--allow-static` audit opt-out to bypass review. That option is unrelated to a web lane's static
build/hosting render mode, which retains the applicable responsive and dynamic behavior contract.

Treat an audit failure as a **project-readiness blocker**, never as a missing capability in the selected lane.
Name the missing journey state (for example, form validation/error and success feedback), state that the selected
lane supports it, and say that export remains blocked until the source is corrected and re-audited. Never phrase
an audit finding as “Vue export needs …” or attribute it to a particular web lane.

Keep the page root fluid. For every major region, identify the parent that owns its width/height, its
fill/grow/shrink and min/max rules, scroll ownership, paired pinned anchors, and structural breakpoint changes.
Use a product- and target-derived compact/medium/expanded snapshot matrix. Treat editor/parity snapshot dimensions
as metadata, never an authoring baseline, and add structural breakpoints only when content or interaction needs
to reflow.

## Target contract

Use `nui-capabilities matrix` as the target source of truth. Supported target IDs are
`ios-swiftui`, `ios-uikit`, `android-compose`, `android-views`, `rust-desktop`,
`rust-ios`, `rust-android`, `rust-web`, `web-html`, `web-react`, `web-vue`,
`web-angular`, `web-astro`, `csharp-desktop`,
`csharp-ios`, and `csharp-android`.

- `--target auto`, `mobile`, and `mobile-flagship` mean the stable flagship pair: SwiftUI + Compose. It is the
  default for a bare mobile request. Name the beta Rust mobile option (shared Rust runtime/action seam) and C#
  mobile option (shared .NET/AppActions seam), and ask about one OS only when scope is ambiguous.
- A bare web request defaults to `web-html` + static only after offering the available lanes: dependency-free
  HTML, React Router, Nuxt/Vue, Angular, and Astro. Framework lanes support static or SSR; ask which mode is
  needed and recommend static unless request-time HTML, personalization/auth, server data, or server SEO needs
  a Node/server-capable host.
- A bare desktop request defaults to beta `rust-desktop`. Present beta `csharp-desktop` for .NET teams and
  Apple-native macOS SwiftUI for teams that need platform-specific desktop UI. Explain that SwiftUI requires a
  separately scoped/new `macos-swiftui` exporter because none is registered; never map `ios-swiftui` to desktop.
- Repeated `--target`, target groups, and `--all-targets` are valid.
- A target remains beta until its capability, build, run, test, and release gates are green. Never describe a
  beta target as release-verified; show its gates with `nui-capabilities show <target-id>` and `nui-doctor`.

Ask only unresolved decisions that materially affect output. Resolve target IDs and web rendering first, then
supported widths/OS/browser/input modes, the primary dynamic journey and UX states, backend/auth/data, and
hosting/distribution. State the recommended default and record assumptions when the user asks you to continue.
The shared `nativeui/references/delivery-targets.md` contains the complete phase-specific question brief.

## Durable logic rules

1. Generated UI is read-only. Re-export refreshes generated files but preserves manifest-declared write-once seams.
2. Put logic in the seam named by the target manifest:
   - SwiftUI `AppActions.swift`; UIKit `NuiBackend.swift` plus connectors.
   - Compose `NuiAppActionsImpl.kt`; Views `NuiBackend.kt` plus connectors.
   - Rust `app_actions.rs`; C# `AppActions.cs`; vanilla web `app-actions.js`; framework web
     `app-actions.ts`. Web projects also preserve `data-adapters.*` and `custom-components.*`.
3. Use the typed asynchronous `NuiActionResult` contract for new logic. Keep legacy synchronous hooks working
   through generated adapters. Results may carry typed control mutations, list data, navigation, and structured errors.
4. Derive endpoints/database needs once with `nui-connectors-plan --target ...`, then implement equivalent
   adapters for every selected target.
5. Register API/database definitions in `libraryItems[]`; use data adapters for repeaters. Do not invent
   secret-bearing endpoint constants in generated or durable source. Keep non-secret `repeater.sampleItems`
   for preview and bind live rows through the registered adapter.
6. Store secrets only in account secret storage, environment variables, protected files, or deployment secret
   stores. Never place them in project JSON, arguments, logs, generated source, or docs.
7. Use guarded editor/project synchronization. Stop on local/cloud conflicts; publish only against the expected
   remote revision.

## Workflow

1. Run `preflight.mjs` before hosted import/export/save. Run `nui-doctor --target ...` before local builds.
2. Inspect `nui-capabilities matrix`; resolve the mobile/web/desktop delivery brief, exact target IDs, and web
   static/SSR mode before architecture or export.
3. For cloud/editor work use `nui-editor handoff|resume|publish`. For one-screen changes use
   `nui-screen-extract` and `nui-screen-update`; preserve other screens and metadata.
4. Validate responsiveness and dynamic flow. Register API/database items and adapters with `nui-library.mjs` before writing logic;
   pass secret values through `put-secret --secret-stdin`.
5. Run `nui-connectors-plan project.json --target ...`; implement each selected durable seam identically.
6. If a server is needed, use an approved `nativeui-architecture.md` that records client targets, web
   rendering/hosting, origins/auth/cookies/cache policy, repository shape, and deployment environments; derive endpoints once with
   `nui-backend-plan`, scaffold the server, and generate target adapters against the same contract.
7. Export with `nui-export project.json --target ...` or `--all-targets`. Treat
   `nativeui-export-manifest.json` as the ownership/toolchain/run/release contract.
8. Generate target-specific tests with `nui-test-gen --target ...`, run locally with `nui-run --target ...`,
   and review every selected export with `nui-final-review --target ... --target-dir <id>=<dir>`.
9. For releases, resolve target artifacts plus web provider/runtime/domain/base path, mobile store/signing, or
   desktop OS/architecture/signing/update-channel choices. Run `nui-doctor --release`, then
   `nui-release plan|build|validate`. Upload/deploy only after explicit user approval and only with
   `--confirm-external`.

Hosted authentication is SSO/session-only. Do not ask for Firebase or NativeUI service API keys. If hosted
preflight is unavailable, continue only with repo-local work and report hosted verification as an explicit gap.
