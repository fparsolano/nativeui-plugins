---
name: nativeui-connect
description: >-
  Wire APIs, databases, navigation, forms, state, timelines, repeaters, live data, and typed UI mutations into
  one or more exported NativeUI targets. Use when application logic must behave equivalently across SwiftUI,
  UIKit, Compose, Android Views, Rust, C#, or web while surviving UI re-export.
metadata:
  argument_hint: "[project.json] [--target auto|<target-id|group>...] [behavior]"
allowed-tools: "Bash(node <bin>/*) Bash(node <bin>/*) Read Write Edit Grep Glob"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui-connect` inside the installed plugin source before running commands.



# Connect NativeUI application logic

Derive one logical contract from `project.json`, then implement it in every selected target's durable seam.
Never edit generated UI. Read `<this-skill>/../nativeui/references/backend-contract.md` before writing
logic.

## Workflow

1. Run hosted preflight when import, export, library, or cloud work is needed. Run `nui-doctor` before local
   compilation.
2. Resolve targets with `nui-capabilities matrix` and the delivery brief in
   `../nativeui/references/delivery-targets.md`. Mobile defaults to flagship SwiftUI + Compose, web requires the
   selected lane/render mode. Desktop defaults to Rust; present C# and the separately scoped/new macOS SwiftUI
   exporter alternative, then implement only registered targets in the approved target set.
3. Validate the project and guarded-sync cloud-backed work. Stop on conflicts.
4. Walk every stage and node to collect stable control IDs, authored interactions, API/database library items,
   forms, data adapters, and repeater sources.
5. Register API/database metadata with `nui-library.mjs`. Keep secret values in account/deployment secret
   storage, environment variables, or protected files—never in project JSON or generated source.
6. Generate the equivalent target plans:

   ```bash
   node <bin>/nui-connectors-plan.mjs project.json --target auto --human
   node <bin>/nui-connectors-plan.mjs project.json --target rust --target csharp --target web-all --human
   ```

7. Implement each selected durable seam. Use the lane-native async contract for new behavior:

   | Target | Durable seam | Async form |
   | --- | --- | --- |
   | `ios-swiftui` | `AppActions.swift` | `async`/`await` |
   | `ios-uikit` | thin `NuiBackend.swift` + connectors | `async`/`await` |
   | `android-compose` | `NuiAppActionsImpl.kt` | `suspend` |
   | `android-views` | thin `NuiBackend.kt` + connectors | `suspend` |
   | Rust lanes | `app_actions.rs` | async result/future |
   | C# lanes | `AppActions.cs` | `ValueTask<NuiActionResult>` |
   | `web-html` | root `app-actions.js`, `data-adapters.js`, `custom-components.js` | `Promise<ActionResult>` |
   | `web-react`, `web-vue` | `app/seams/app-actions.ts`, `data-adapters.ts`, `custom-components.ts` | `Promise<ActionResult>` |
   | `web-angular` | `src/app/seams/app-actions.ts`, `data-adapters.ts`, `custom-components.ts` | `Promise<ActionResult>` |
   | `web-astro` | `src/seams/app-actions.ts`, `data-adapters.ts`, `custom-components.ts` | `Promise<ActionResult>` |

   For web, take the exact paths from the target plan or `nativeui-export-manifest.json`. Exported route modules
   and framework components already implement navigation, local state, visibility, selection, form mechanics,
   and timelines directly. Put external effects in `app-actions.*`, live data in `data-adapters.*`, and explicit
   hand-authored integrations in `custom-components.*`.
8. Return `NuiActionResult`/`ActionResult` values for control mutations, list rows, navigation, and structured errors. Route
   lifecycle, URL, API, database, form, timeline, state, animation, repeater, and live-data actions through the
   same logical branches on all targets. Generated adapters keep existing synchronous hooks compatible.
9. Re-export with the same target list. The archive manifest declares generated and write-once files; merge-aware
   extraction preserves all app-action, data-adapter, and custom-component implementations and writes changed
   upstream stubs as `.new` for review. Generated `contracts.ts`/`contracts.d.ts` files regenerate; merge the
   candidate deliberately when its contract changes.
10. Generate tests, run available hosts, and review with the identical targets:

    ```bash
    node <bin>/nui-test-gen.mjs project.json --target auto --out ./native-out
    node <bin>/nui-run.mjs project.json --target auto
    node <bin>/nui-final-review.mjs --project project.json --target auto --target-dir ios-swiftui=./native-out/ios --target-dir android-compose=./native-out/android
    ```

## Hard rules

- Treat generated UI, stage registries, typed controls, delegates, and runtime scaffolds as read-only.
- Keep UIKit/View backend delegators thin; connectors own durable behavior.
- Preserve stable control and stage IDs. If an ID changes, update every selected seam and its tests.
- Derive server endpoints once. Do not create target-specific endpoint drift.
- Keep visual structure and styling in the NativeUI design/editor; use action results for runtime state only.
- Gate arbitrary script execution. Full target support never weakens sandbox or secret protections.
- Do not claim a beta target is release-verified. Report its capability and doctor gates.

If the app needs a server, use `nativeui-architect` first, then `nativeui-backend` to scaffold and deploy the
approved server and point every selected adapter at the same environment-aware base URL.
