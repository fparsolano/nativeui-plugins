# NativeUI Codex integration policy

Use the shared NativeUI skills and tools to create, edit, connect, run, test, package, and release apps. Do not
hand-author generated platform UI.

## Target selection

- Read `nativeui-plugin/capabilities/nativeui-targets.json` or run `nui-capabilities matrix`.
- Accept all 16 target IDs, repeated targets, groups, `auto`, and `--all-targets`.
- `auto`/`mobile` defaults to stable `ios-swiftui` + `android-compose`; name beta Rust/C# mobile alternatives.
- `web` defaults to `web-html` + static after offering HTML, React, Vue, Angular, and Astro plus static/SSR.
- `desktop` defaults to beta `rust-desktop`; present beta `csharp-desktop` and an Apple-native macOS SwiftUI
  alternative. Explain that SwiftUI requires a separately scoped/new `macos-swiftui` exporter because none is
  registered; never substitute `ios-swiftui` for desktop.
- Ask only unresolved target/runtime/width/journey/backend/hosting/distribution questions and state defaults.
- Preserve beta labels until capability, round-trip, compile, render, run, test, package, and release gates pass.

## Workflow

1. Use the shared delivery brief, then `nativeui-design` for loose inputs; it produces the styling guide,
   responsive/motion direction, parent-constraint matrix, journey, and UX state plan.
2. Author plain HTML/CSS and import to `project.json`. Every design must have real responsive reflow and dynamic
   flow: wired actions, multi-screen navigation, and relevant loading/empty/error/success states. Run both
   `nui-responsive-audit` and `nui-flow-audit` before and after import; static opt-outs do not bypass the gate.
3. Use `nui-editor handoff|resume|publish` for editor work. Use `nui-screen-extract` and `nui-screen-update` for
   a one-screen change; never replace unrelated screens or metadata.
4. Derive APIs, databases, forms, repeaters, navigation, state, and timelines once. Implement equivalent typed
   `NuiActionResult` behavior in each selected manifest-declared durable seam.
5. Export with target IDs. Treat `nativeui-export-manifest.json` as the generated/write-once ownership and
   toolchain contract.
6. Run doctor, test generation, local hosts, final review, and release planning with the same target list.
7. Require explicit approval for uploads, deployments, notarization, and store submission.

Generated UI and runtime registries are read-only. Preserve `AppActions.swift`, `NuiBackend.swift` plus
connectors, `NuiAppActionsImpl.kt`, `NuiBackend.kt` plus connectors, `app_actions.rs`, `AppActions.cs`, and
`app-actions.js` across re-export. Keep secrets out of project JSON, generated source, arguments, docs, and logs.

The canonical developer skill is `nativeui-codex/canonical/nativeui-developer/SKILL.md`; the Claude mirror is
byte-identical. After shared-source changes, regenerate the target catalog and Codex package, then run the plugin,
service, Java, and Rust checks that apply. Do not describe hosted smoke as complete when NativeUI auth or network
access is unavailable.
