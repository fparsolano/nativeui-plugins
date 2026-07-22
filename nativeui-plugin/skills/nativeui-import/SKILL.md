---
name: nativeui-import
description: >-
  Import EXISTING HTML/CSS file(s) into a NativeUI project (project.json). Use only when the user already has
  HTML/CSS on disk and wants just the import step — not authoring a new app from an idea (use nativeui-app for
  that). Runs the auth preflight, then converts the given HTML page(s) into one project.json via the NativeUI
  import service.
metadata:
  argument_hint: "[file.html ...] [-o project.json]"
allowed-tools: "Bash(node ${CLAUDE_SKILL_DIR}/../../bin/*) Bash(node */nativeui-plugin/bin/*) Read Glob"
---

# Import HTML/CSS → NativeUI project

Convert one or more EXISTING HTML/CSS documents into a single NativeUI `project.json`. This is the standalone
import step. If the user wants to author a brand-new app from an idea, use **nativeui-app** instead; for the
full author→import→export playbook use **nativeui**.

`<bin>` below = `${CLAUDE_SKILL_DIR}/../../bin` (the plugin's toolchain scripts; pure Node 18+, no deps).

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
Identify the HTML file(s) to import and their order (each becomes a screen; the page name is the file
basename). The pages must already satisfy the NativeUI authoring surface — plain HTML/CSS only, no `<script>`,
no external/CDN stylesheets. Arbitrary `data-*` attributes are stripped; only documented reserved portable
`data-nui-*` attributes are allowed. If a file violates that, fix the HTML/CSS itself (see
`${CLAUDE_SKILL_DIR}/../nativeui/references/authoring-rules.md`); never edit around an import error.

## 3. Import
```bash
node <bin>/nui-import.mjs page1.html page2.html -o project.json
```
The script POSTs to `/export/import/html` with a fresh token and writes the returned project to `-o` (default
`./project.json`). If the service returns `errors[]`, it prints them and **writes nothing** — FIX the offending
HTML/CSS and re-import. Never hand-edit `project.json` to paper over an import error.

## 4. Hand off
Report the output path and the stage/node summary the script prints. To produce native apps from the project,
use **nativeui-export**; to wire backend behavior, use **nativeui-connect**.
