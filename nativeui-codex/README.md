# NativeUI for Codex

NativeUI gives Codex an end-to-end workflow for designing, building, updating, connecting, testing, and preparing
responsive applications for release.

Start with an idea, screenshot, PDF, Figma design, HTML/CSS, source project, or URL. Codex will help clarify the
user journey, required states, target platforms, backend needs, and deployment expectations before producing
platform-appropriate output.

## Highlights

- Responsive, parent-constrained layouts with dynamic reflow by default.
- Complete user journeys including navigation, forms, lists, validation, loading, empty, error, retry, selected,
  disabled, and success states.
- Native Apple and Android exports, Rust and C# delivery options, and authored HTML, React, Vue, Angular, and
  Astro PWAs.
- Static or SSR framework-web delivery, with vanilla HTML defaulting to a dependency-free static PWA.
- Safe one-screen updates and NativeUI editor handoffs that preserve unrelated work.
- Durable typed seams for application actions, APIs, databases, authentication, data adapters, and custom
  components.
- Target-aware local run, test, accessibility, review, packaging, and release preparation.

## Choosing a target

- **Mobile:** the default is the flagship SwiftUI + Compose pair. Choose Rust for a shared systems-language
  stack or C# when the product and team are centered on .NET.
- **Web:** the default is authored vanilla HTML with static delivery. Choose React, Vue, Angular, or Astro based
  on the existing team and ecosystem; each framework lane can use static generation or SSR.
- **Desktop:** Rust is the default. C# is the .NET alternative. Apple-native macOS with SwiftUI is a separately
  scoped project rather than an iOS-export substitution.

The plugin asks about choices that affect product behavior or delivery instead of assuming a fixed canvas,
framework, backend, hosting provider, or rendering mode.

## Example prompts

```text
Build a responsive habit coaching app for mobile. Use the flagship targets, include
onboarding and progress journeys, and account for loading, offline, and error states.
```

```text
Create an Astro PWA for this product brief. Compare static and SSR for my deployment,
ask me the missing architecture questions, and make every route work by direct URL.
```

```text
Connect this existing NativeUI project to my API, preserve the generated UI contract,
run the relevant tests locally, and give me a release-readiness report without deploying.
```

## Install

```bash
codex plugin marketplace add fparsolano/nativeui-plugins
codex plugin add nativeui@nativeui-marketplace
```

Start a new Codex task after installation. Hosted NativeUI operations use browser sign-in and require beta access
plus an active subscription; the plugin does not ask for service API keys. Keep credentials in approved secret
storage, and approve external publishing or deployment only after reviewing the local release plan.

## Working well with NativeUI

- Share the primary users, journeys, source material, target surfaces, and existing technical constraints.
- Describe desired outcomes and interaction states; let responsive rules follow content and parent constraints.
- State when a genuinely static or fixed composition is intentional.
- Keep custom business logic in preserved extension seams so future UI exports remain safe.
- Run responsive, interaction, accessibility, capability, and target build checks before release.

Plugin contributors should run the shared plugin test suite and rebuild the Codex package before submitting
changes. The generated marketplace artifact must stay synchronized with the shared NativeUI workflows.
