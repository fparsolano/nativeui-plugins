# NativeUI AI plugin

Build responsive, dynamic applications with Claude Code or Codex, from the first design conversation through
export, testing, and release preparation. NativeUI can start from a product idea or existing material such as
screenshots, PDFs, Figma designs, HTML/CSS, source code, and URLs.

The plugin keeps design intent, application behavior, and delivery targets in one workflow. It asks the product
and deployment questions that materially affect the result, then helps produce UI that feels intentionally
authored for each selected platform.

## What you can do

- Design complete multi-screen journeys with navigation, forms, lists, loading states, errors, empty states,
  selection, retry, and success feedback.
- Create responsive layouts that reflow from parent constraints across compact, medium, expanded, portrait, and
  landscape contexts. Fixed or pinned sizing is used only when you explicitly request a static composition.
- Import existing HTML/CSS into an editable NativeUI project and safely update individual screens later.
- Export native Apple and Android apps, Rust and C# applications, or authored web projects.
- Connect APIs, databases, authentication, local state, actions, timelines, and typed data adapters.
- Run target-aware checks, generate tests, review capability parity, and prepare builds and deployment plans.
- Hand work to the NativeUI editor and resume without replacing unrelated screens or durable application logic.

## Delivery choices

NativeUI recommends a starting point while keeping alternatives visible:

| Surface | Default | Alternatives |
| --- | --- | --- |
| Mobile | SwiftUI + Compose flagship pair | Rust for a shared systems-language stack; C# for .NET teams |
| Web | Vanilla HTML PWA, static | React, Vue, Angular, or Astro; framework lanes support static and SSR |
| Desktop | Rust | C# for .NET; SwiftUI for a separately scoped Apple-native macOS project |

Web exports are routed, accessible PWAs with semantic markup, direct framework-native behavior, responsive
reflow, and developer-owned extension points. They do not ship iframe shells or require a runtime model
interpreter.

## Recommended workflow

1. **Describe the product.** Share the audience, primary journeys, visual direction, source material, and target
   platforms. If key choices are missing, the plugin asks before committing to architecture or deployment.
2. **Confirm the experience.** Review screens, navigation, data and form states, accessibility, motion, and the
   responsive behavior of each meaningful region.
3. **Choose delivery targets.** Confirm mobile, web, or desktop lanes and, for framework web projects, static or
   SSR delivery.
4. **Author and export.** Create or update the NativeUI project and export platform-appropriate projects with
   durable seams for custom actions, data, and components.
5. **Connect behavior.** Implement APIs, storage, authentication, mutations, and external effects against typed
   contracts that survive future UI exports.
6. **Verify and release.** Run the relevant build, type, unit, interaction, responsive, accessibility, and
   packaging checks before approving an external deployment.

## Workflow shortcuts

You can simply describe the outcome you want, or invoke a focused workflow by name:

- `nativeui-design` turns loose references into a responsive styling guide and interaction direction.
- `nativeui-app` creates a complete application; `nativeui-update` changes one existing screen safely.
- `nativeui-editor` hands work to the editor or resumes it without replacing unrelated changes.
- `nativeui-architect` records backend and deployment decisions in `nativeui-architecture.md` before major
  infrastructure work; `nativeui-connect` and `nativeui-backend` connect the approved behavior.
- `nativeui-export`, `nativeui-run`, `nativeui-test`, and `nativeui-review` prepare and verify selected targets.
- `nativeui-release` produces the release plan and asks for approval before external publication.

## Best practices

- Start with user journeys and states, not a collection of isolated screens.
- Let content and parent constraints drive layout; introduce breakpoints only when the experience needs to
  reflow.
- Use semantic controls, clear labels, keyboard support, sensible focus order, and adequate contrast.
- Keep secrets out of project files, prompts, command arguments, generated source, and logs.
- Put custom application logic in the exported project’s preserved action, adapter, and component seams.
- Re-export generated UI instead of manually merging generated source; keep developer-owned files separate.
- Review capability receipts so no supported interaction, trigger, timeline, or responsive behavior disappears
  silently on a selected target.
- Treat deployment as an explicit final step after local verification and approval.
- Use the normal clean/prod export for runnable delivery. The `--beta` option is only for explicit internal
  parity instrumentation, not a visual style or release channel.

## Example requests

```text
Design a responsive meal-planning app for iOS and Android. Include onboarding,
weekly planning, grocery lists, loading and empty states, and offline-friendly edits.
Use the flagship mobile targets and prepare it for local testing.
```

```text
Turn these dashboard screenshots into a responsive React PWA. Use SSR, preserve the
desktop information density, reflow naturally on mobile, and connect the filters and
tables to my existing API.
```

```text
Update only the checkout screen in this NativeUI project. Improve validation and
keyboard navigation, keep the existing backend contract, then re-export web-html and
web-astro without changing the other screens.
```

```text
Audit this project for responsive issues, incomplete user states, capability gaps,
and release blockers across Rust desktop and C# desktop. Do not deploy anything yet.
```

## Setup

Use Node.js 18 or newer. Hosted import, export, editor, and save operations require NativeUI browser sign-in,
beta access, and an active subscription. Local capability lookup, planning, diagnostics, and supported build or
test workflows remain available without hosted access.

For Claude Code, install from the NativeUI marketplace. For Codex, install the NativeUI plugin and start a new
task so the complete workflow is available. See the public marketplace README for the current install commands.

## Contributing

From this directory, run `npm test` before submitting plugin changes. Tests cover workflow routing, target and
capability guidance, responsive defaults, preservation behavior, generated package freshness, and secret-safe
release handling.
