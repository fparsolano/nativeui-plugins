---
name: nativeui-run
description: >-
  Build and launch exported NativeUI targets locally: SwiftUI/UIKit, Compose/Views, Rust desktop/mobile/web,
  C# desktop/mobile, and authored HTML/React/Vue/Angular/Astro PWAs. Use when the user wants to run,
  preview, or smoke-test an app on locally
  available simulators, emulators, desktops, or browsers.
metadata:
  argument_hint: "[project.json | --project <dir>] [--target auto|<target-id|group>...] [--all-targets]"
allowed-tools: "Bash(node ${CLAUDE_SKILL_DIR}/../../bin/*) Bash(node */nativeui-plugin/bin/*) Bash(adb*) Bash(xcrun*) Bash(xcodebuild*) Bash(dotnet*) Bash(cargo*) Bash(rustup*) Read Glob"
---

# Run NativeUI locally

Use `<bin>` as `${CLAUDE_SKILL_DIR}/../../bin`.

If the user has not selected a delivery target, follow `../nativeui/references/delivery-targets.md` and state
the contextual default before running. Ask for a web lane/render mode only when it changes the requested smoke
test; otherwise static is the safe default.

Clean/prod is the normal runnable build. `--beta` is reserved for parity instrumentation and is not a release
qualification.

Start with a target-aware readiness report, then run the selected targets:

```bash
node <bin>/nui-doctor.mjs --target auto --human
node <bin>/nui-run.mjs project.json --target auto -o ./nui-run-out
node <bin>/nui-run.mjs project.json --target rust --target web-html -o ./nui-run-out
node <bin>/nui-run.mjs project.json --target web-react --render-mode ssr -o ./nui-run-out
node <bin>/nui-run.mjs project.json --all-targets -o ./nui-run-out
```

For an already-exported tree, use `--project <dir>`. Use `--no-launch` for build/installation-only
verification and `--device <id-or-name>` to select an Android or iOS device.

`auto` runs SwiftUI and Compose. Each selected target is exported in prod mode when project JSON is supplied.
The runner discovers Android Gradle, Xcode, Cargo, .NET, and PWA project roots; it launches each locally
available host and reports prerequisites for every skipped host. Rust target IDs map to host desktop, iOS
Simulator, Android, and browser respectively. Web validates the installable shell and serves it over HTTP.
C# uses the generated host project for the requested target.

Web defaults to `--render-mode static`. Use `--render-mode ssr` for React, Vue, Angular, or Astro;
dependency-free `web-html` accepts only static mode.

The render-mode flag selects build/hosting behavior only. Static mode must still exercise the same applicable
responsive constraints, routes, interactions, state, forms/lists, timelines, service worker, and developer seams.

A missing toolchain or device is a target-specific skip, not permission to claim that target passed. Report the
exact built/installed/launched state for every requested target. After running, verify navigation, responsive
layout, animation, forms, live data/failure state, and accessibility in proportion to the change.

Legacy `--platform android|ios|both|rust` and `--rust-target` remain accepted for compatibility. New
workflows should use target IDs so the exporter, doctor, test generator, review, and release tools all refer to
the same lane.
