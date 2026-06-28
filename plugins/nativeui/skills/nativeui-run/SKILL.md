---
name: nativeui-run
description: >-
  Build, install, and LAUNCH an exported NativeUI app on the local Android emulator and/or iOS simulator —
  a fully-functional PROD-quality app (animations auto-play, responsive @media divisions resolve at the
  device width, effects render, events/nav work), NOT the parity harness. Use when the user wants to run /
  preview / try / see their app on a real emulator or simulator. Detects available toolchains + devices,
  exports in clean PROD mode if needed, then builds + launches; skips a platform gracefully if its
  toolchain/device is absent.
metadata:
  argument_hint: "[project.json | --project <dir>] [--platform android|ios|both]"
allowed-tools: "Bash(node <bin>/*) Bash(node <bin>/*) Bash(adb*) Bash(xcrun*) Bash(xcodebuild*) Bash(simctl*) Bash(emulator*) Read Glob"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui-run` inside the installed plugin source before running commands.



# Run a NativeUI app on the local emulator / simulator

Launch the user's exported app on the **local Android emulator and/or iOS simulator** as a real,
fully-functional product. This is NOT the parity-capture harness — it's the CLEAN/PROD build: animations
auto-play (on-device timeline runtime), responsive `@media` breakpoints resolve at the device width
(smart-division runtime), effects (shadows/gradients/clip/blur) render, and events/navigation work.

`<bin>` below = `<bin>` (the plugin's toolchain scripts; pure Node 18+, no deps).

## When to use
The user says "run it", "open it on the simulator/emulator", "let me see it", "try the app", "preview on a
device". Often the natural next step after **nativeui-app** / **nativeui-export** finishes.

## 1. Decide the input
`nui-run.mjs` takes either:
- a **`project.json`** — it first runs `nui-export` for each platform into `-o <outdir>` to produce the
  clean tree, then builds + launches; or
- an **already-exported tree** via `--project <dir>` (skip export). The dir may contain `android/` + `ios/`
  subdirs, or be a single platform's tree.

IMPORTANT: to run the PROD app, the export must be **clean/prod**. That is now `nui-export`'s default; `--beta`
is the internal capture harness and is not what we launch. When given a `project.json`, `nui-run` handles this for you.

## 2. Run it
```bash
# From a project.json (exports clean/prod first, then builds + launches both platforms):
node <bin>/nui-run.mjs project.json --platform both -o ./nui-run-out

# Or from an already clean-exported tree:
node <bin>/nui-run.mjs --project ./nui-run-out --platform both
```
Flags: `--platform android|ios|both` (default both) · `--project <dir>` (skip export) · `-o <dir>` (export
dest when given a project.json) · `--device <id>` (android serial like `emulator-5554`, or an iOS udid/name
like `iPhone 17`) · `--no-launch` (build + install only).

What it does per platform, with **graceful degradation** (a missing toolchain/device skips that platform, never
fails the whole command):
- **Android** — finds `adb` (PATH or `$ANDROID_HOME`/`~/Library/Android/sdk`); uses a booted device or boots an
  AVD; the clean export pins the Gradle version but ships no `gradlew`, so `nui-run` regenerates the pinned
  wrapper with a system `gradle` and surfaces `ANDROID_HOME` to AGP; then `:app:installDebug` →
  `adb shell am start -n <applicationId>/.MainActivity`.
- **iOS** (macOS only) — finds `xcrun simctl`; uses a booted simulator or boots one (prefers `iPhone 17`); the
  clean exporter emits a shared `<App>.xcscheme`, so `xcodebuild -scheme <App> -sdk iphonesimulator`
  (no code signing for a sim build) → `simctl install` → `simctl launch <bundleId>`.

## 3. Report what happened
`nui-run` prints a summary, e.g. `ios: built + installed + launched on iPhone 17` and
`android: built + installed + launched on emulator-5554`, or `SKIPPED <platform>: <reason>`. Relay it. For any
**skipped** platform, pass along the fallback it printed ("open in Android Studio / Xcode at <path>") — a skip
is not a failure; the other platform may still have launched.

Then confirm the app is functional: the animations move, the layout has adapted to the device width (divisions
resolved), effects render, and a tap / `<a href>` navigation works. Optionally screenshot to show the user
(`xcrun simctl io booted screenshot out.png`; `adb exec-out screencap -p > out.png`).

## Notes
- The user runs a **real prod-quality app**, not the capture harness — that's the whole point: prove it works
  on a device, end to end.
- Need to author/import/export first? Use **nativeui-app** (full pipeline) or **nativeui-export** (export only),
  then come back here. To wire backend behavior (login/fetch/save/taps) use **nativeui-connect**.
- Toolchain absent (no Xcode, no Android SDK, no devices)? `nui-run` skips and tells the user how to open the
  project in the IDE; relay that instead of treating it as an error.
