---
name: nativeui-review
description: >-
  Final target-aware NativeUI review before handoff or release. Verify responsive UI, dynamic flows and states, editor preservation,
  capability dispositions, durable logic placement, and exported host/manifests for every selected target.
metadata:
  argument_hint: "--project project.json --target <target-id|group> --target-dir <id>=<dir>"
allowed-tools: "Bash(node <bin>/*) Bash(node <bin>/*) Read Glob Grep"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui-review` inside the installed plugin source before running commands.



# Final NativeUI review

Use `<bin>` as `<bin>`.

Run the reviewer with every selected export:

```bash
node <bin>/nui-final-review.mjs --project project.json \
  --target ios-swiftui --target-dir ios-swiftui=./exports/ios-swiftui \
  --target android-compose --target-dir android-compose=./exports/android-compose \
  --instructions user-instructions.md --human
```

Use `--all-targets` only when a directory is supplied for each target. The review validates the project and
HTML surface, mandatory responsive parent-owned constraints (including scroll ownership and structural reflow),
dynamic journey/state coverage, interactions, registered API/database items, approved backend architecture,
generated-vs-durable ownership, target manifest identity, write-once seams, and required host artifacts. The
legacy `--android-dir` and `--ios-dir` connector-parity checks remain supported.

A target review passes only when the requested export and `nativeui-export-manifest.json` are present and
match the target ID. Missing C#/Rust mobile hosts, web PWA assets, protected seams, or selected target
directories are errors. Capability-matrix beta status remains beta even when the structural review passes.

For authored web targets, inspect every clean route and reject iframe shells, `data-nui-*` transport markers,
shipped `project.json`, serialized model/interaction blobs, generic model/DOM interpreters, meaningless
generated names, and dynamically constructed Tailwind class names. Verify direct route loads, client
navigation, the selected static/SSR behavior, offline fallback, and that the service worker excludes API,
authentication, POST, and user-specific responses.

Reconcile every manifest-declared capability occurrence, node kind, action, trigger, and timeline property with
that lane's exact disposition and exact implementation receipt. Fail closed on a missing receipt or required carrier;
reference-lane parity, a shared planner declaration, and aggregate capability counts are not implementation
evidence.

For editor updates, confirm the target screen retained its stage ID/name/board placement, other screens and
project metadata remained unchanged, and library collisions were remapped safely. For behavior work, ensure
all selected targets implement equivalent logic through their durable seams; generated UI must not contain
business logic or secrets.

Resolve every error before handoff. Warnings require an explicit disposition. Then run the manifest-declared
build/test commands and use `nui-release validate` for release artifacts.
