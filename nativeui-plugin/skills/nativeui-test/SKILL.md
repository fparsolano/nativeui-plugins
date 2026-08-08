---
name: nativeui-test
description: >-
  Generate and run contract/smoke tests for exported NativeUI targets. Use after export or when verifying the
  durable action seam, generated UI contract, navigation, or target parity across Swift, Kotlin, Rust, C#, and web.
metadata:
  argument_hint: "<project.json> --target auto|<target-id|group> --out <export-dir>"
allowed-tools: "Bash(node ${CLAUDE_SKILL_DIR}/../../bin/*) Bash(node */nativeui-plugin/bin/*) Bash(cargo*) Bash(dotnet*) Bash(./gradlew*) Bash(xcodebuild*) Read Write Glob"
---

# Test NativeUI target contracts

Use `<bin>` as `${CLAUDE_SKILL_DIR}/../../bin`.

Generate lane-specific tests with the same target IDs used for export:

```bash
node <bin>/nui-test-gen.mjs project.json --target auto --out ./exports
node <bin>/nui-test-gen.mjs project.json --target rust --target web-all --out ./exports
node <bin>/nui-test-gen.mjs project.json --all-targets --out ./exports
```

The generator never edits generated UI. It writes tests beside each export:

- Compose checks `NuiAppActionsImpl` against `NuiAppActions`; Android Views checks NuiBackend controls/delegates.
- SwiftUI checks the AppActions seam; UIKit checks typed controls and delegate hooks.
- Rust writes a Cargo integration test for `NuiBackend` and `NuiScreenControls`.
- C# writes an xUnit project referencing the generated app and its `AppActions.cs`.
- Vanilla web writes a side-effect-free Node test for the root Promise-based `app-actions.js` seam.
- React and Vue write a Vitest TypeScript contract test against `app/seams/app-actions.ts`; Angular writes an
  included `src/**/*.spec.ts` test against `src/app/seams/app-actions.ts`; Astro targets
  `src/seams/app-actions.ts`. These tests consume the regenerated `contracts.ts` types and never invoke
  application effects.

Run each target's manifest-declared test command. A compile-only seam check is useful but does not replace
interaction, responsive, animation, accessibility, navigation, form, API/database, repeater, failure-state,
and screenshot parity gates when those capabilities are in scope.

For web, test every clean route by direct load and client navigation. Static and SSR builds must both pass when
selected; SSR responses must contain meaningful page content before hydration. Add offline, service-worker
update, accessibility, responsive geometry, form/list/timeline, and hydration-warning coverage in proportion to
the app, while confirming API/auth/POST/user-specific responses are never cached.

Legacy `--platform android|ios|both|rust` remains accepted and emits the legacy contract tests. New work
uses `--target` so flagship and non-mobile lanes receive the correct test surface.
