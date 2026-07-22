---
name: nativeui-export
description: >-
  Export an existing NativeUI project.json to one or more first-class target archives: SwiftUI, UIKit,
  Compose, Android Views, Rust desktop/mobile/web, C# desktop/mobile, and authored HTML, React, Vue, Angular,
  or Astro PWAs. Use only when project.json
  already exists and the user wants export, manifests, packaging inputs, or merge-aware re-export.
metadata:
  argument_hint: "[project.json] [--target auto|<target-id|group>...] [--all-targets] [-o outdir]"
allowed-tools: "Bash(node <bin>/*) Bash(node <bin>/*) Read Glob"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui-export` inside the installed plugin source before running commands.



# Export an existing NativeUI project

Use `<bin>` as `<bin>`. Run preflight before hosted export.

Inspect target status first:

```bash
node <bin>/nui-capabilities.mjs matrix --human
node <bin>/nui-export.mjs project.json --target auto -o ./native-out
node <bin>/nui-export.mjs project.json --target rust --target web-html -o ./native-out
node <bin>/nui-export.mjs project.json --target web-all -o ./native-out
node <bin>/nui-export.mjs project.json --all-targets -o ./native-out
```

When target intent is not already fixed, use `../nativeui/references/delivery-targets.md`: mobile defaults to
flagship SwiftUI + Compose (with Rust/C# alternatives), web defaults to dependency-free HTML + static after the
lane/render choice is offered, and desktop defaults to Rust. Present C# as the available .NET lane and macOS
SwiftUI as an Apple-native alternative requiring a separately scoped/new exporter; no `macos-swiftui` target is
registered, so never substitute `ios-swiftui`.

`auto` is SwiftUI plus Compose. Repeated targets and groups are deduplicated; shared Rust and C# exporters
produce one project that contains their host lanes. Legacy `--platform android|ios|both|rust|csharp|web`
aliases remain accepted.

The `web` alias remains the dependency-free `web-html` lane. The `web-all` group selects `web-html`,
`web-react`, `web-vue`, `web-angular`, and `web-astro`. Framework web projects support
`--render-mode static|ssr` in run and release tooling; static is the default.

Choose HTML for the smallest portable static PWA; React for React Router/TypeScript ecosystem work; Vue for
Nuxt/SFC/composable conventions; Angular for strict standalone/signals enterprise structure; and Astro for
HTML-first content with selective islands. SSR requires request-time behavior and a compatible server host.

The Rust group resolves `rust-desktop`, `rust-ios`, `rust-android`, and `rust-web`. Clean/prod is the default
runnable export. Use `--beta` only for internal parity instrumentation; it does not promote a lane's status.

Every ZIP contains `nativeui-export-manifest.json` with exact target IDs, generated files, write-once files,
capability status, prerequisites, and run/test/release commands. Manifest-only inspection is available for
every exporter:

```bash
node <bin>/nui-export.mjs project.json --target <target-id> --manifest -o ./manifests
```

Extraction is merge-aware. Generated files refresh. Existing `AppActions.swift`, `NuiBackend.swift`,
`NuiAppActionsImpl.kt`, `NuiBackend.kt`, `app_actions.rs`, `AppActions.cs`, `app-actions.js`,
`app-actions.ts`, `data-adapters.*`, and `custom-components.*`
are preserved; a changed upstream contract lands as `<name>.new` for review. Use `--force` only when the
user explicitly wants to overwrite durable seams.

`POST /export/html` remains the single-screen interchange endpoint. The complete routed installable web app
uses `POST /export/web`. Do not conflate those outputs.

After export, run `nui-test-gen`, `nui-run`, and `nui-final-review` with the same target IDs. Beta lanes
remain labeled beta until their release gates pass.
