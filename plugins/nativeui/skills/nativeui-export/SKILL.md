---
name: nativeui-export
description: >-
  Export an EXISTING NativeUI project (project.json) to native iOS and/or Android projects. Use only when the
  user already has a project.json and wants just the export step — not authoring or importing. Runs the auth
  preflight, then produces the native project ZIP(s) via the NativeUI export service.
metadata:
  argument_hint: "[project.json] [--platform android|ios|both] [-o outdir]"
allowed-tools: "Bash(node <bin>/*) Bash(node <bin>/*) Read Glob"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui-export` inside the installed plugin source before running commands.



# Export NativeUI project → native iOS + Android

Produce native projects from an EXISTING `project.json`. This is the standalone export step. To create a
project from HTML first, use **nativeui-import**; for the full author→import→export playbook use **nativeui**.

`<bin>` below = `<bin>` (the plugin's toolchain scripts; pure Node 18+, no deps).

## 1. Preflight — ALWAYS FIRST, stop on failure
```bash
node <bin>/preflight.mjs
```
Verifies a logged-in dev account **and** an active subscription. On any non-zero exit, relay the printed
remedy verbatim and **STOP**. No config is needed (PUBLIC dev defaults are baked in). Remedies: not signed in →
`node <bin>/login.mjs` (browser SSO); no subscription → activate billing, re-run. (A config error is rare —
only if a `~/.nativeui/config.json` / `NATIVEUI_*` override for another environment blanked a field.)

If a tenant policy or approval reviewer denies upload to `dev.nativeui.com` as external disclosure, **STOP** and
do not retry. Point the user/admin at `admin/codex-requirements.nativeui.example.toml` in the Codex plugin package
to approve the hosted service, or configure an approved internal/self-host export service with
`"exportAuthMode": "none"` for import/export-only fallback.

## 2. Confirm the inputs
Locate the `project.json` and the target platform(s) — default is **both** iOS + Android. Pick an output
directory per platform.

## 3. Export (run once per platform)
```bash
node <bin>/nui-export.mjs project.json --platform android -o ./android-out
node <bin>/nui-export.mjs project.json --platform ios     -o ./ios-out
```
Each writes `<outdir>/<platform>-export.zip` and unzips it in place when an extractor (`unzip`, `python3`, or
`tar`) is available. Clean/prod is the default runnable app: no parity scaffold, on-device animation +
responsive runtimes when needed, and a runnable Xcode scheme / Gradle project. Add `--beta` (or `--mode beta`)
only for the internal capture harness.

## 4. Hand off
Tell the user where each project is and how to open it (Android Studio / Xcode). **Offer to run it locally**:
`node <bin>/nui-run.mjs project.json --platform both` builds + launches the real PROD app (anim/responsive/
effects/events all work) on the local emulator + simulator — see the **nativeui-run** skill. Re-exporting is
round-trip-safe: it regenerates the UI around any untouched `NuiBackend.*`. To wire backend behavior, use
**nativeui-connect**; to change a single screen, use **nativeui-update**.
