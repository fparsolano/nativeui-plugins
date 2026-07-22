# NativeUI plugins

Build responsive, dynamic applications with **NativeUI** and Claude Code or Codex.
Start from a product idea, screenshot, PDF, Figma design, HTML/CSS, source project,
or URL, then carry the work through design, export, application logic, local
verification, and release preparation.

## Capabilities

- Design complete multi-screen journeys with navigation, forms, lists, loading,
  empty, validation, error, retry, selected, disabled, and success states.
- Create responsive layouts that reflow from parent constraints by default across
  compact, medium, expanded, portrait, and landscape contexts.
- Export SwiftUI, UIKit, Compose, Android Views, Rust, C#, or authored web PWAs.
- Choose vanilla HTML, React, Vue, Angular, or Astro for web delivery, with static
  or SSR modes where supported.
- Connect APIs, databases, authentication, state, actions, timelines, and typed
  data adapters through durable extension points.
- Update one screen safely, collaborate through the NativeUI editor, run local
  checks, and prepare target-aware release plans.

## Recommended workflow

1. Describe the users, primary journeys, source material, and delivery surfaces.
2. Confirm responsive behavior, interaction states, accessibility, and motion.
3. Choose mobile, web, or desktop targets and any web rendering mode.
4. Author or update the NativeUI project and export the selected applications.
5. Connect application behavior through preserved action and data seams.
6. Verify builds, interactions, responsiveness, accessibility, and capability
   coverage before approving deployment.

## Best practices

- Design journeys and their states, not isolated screens.
- Let content and parent constraints drive layout. Request fixed sizing only when
  a genuinely static composition is intended.
- Prefer semantic controls, clear labels, keyboard support, and sensible focus.
- Keep business logic in preserved extension files so UI re-exports remain safe.
- Keep credentials out of prompts, project files, generated source, and logs.
- Review target capability results and run local release checks before publishing.

## Examples

```text
Design a responsive meal-planning app for iOS and Android. Use the flagship mobile
targets and include onboarding, weekly planning, empty, offline, and error states.
```

```text
Turn these screenshots into a React PWA with SSR. Preserve desktop density, reflow
naturally on mobile, and connect the filters and tables to my existing API.
```

```text
Update only the checkout screen, improve validation and keyboard navigation, keep
the existing backend contract, and re-export web-html and web-astro.
```

## Claude Code

```
/plugin marketplace add fparsolano/nativeui-plugins
/plugin install nativeui@nativeui-marketplace
```

## OpenAI Codex

Marketplace install:

```
codex plugin marketplace add fparsolano/nativeui-plugins
codex plugin add nativeui@nativeui-marketplace
```

One-liner (clones this mirror + installs the Codex plugin from the mirror marketplace):

```
curl -fsSL https://raw.githubusercontent.com/fparsolano/nativeui-plugins/main/codex-bootstrap.sh | bash
```

Legacy skill-copy fallback:

```
git clone https://github.com/fparsolano/nativeui-plugins.git
cd nativeui-plugins/nativeui-codex && ./install.sh
```

Then restart Codex so it discovers the new skills.

## Setup

Hosted NativeUI operations use browser sign-in and require beta access plus an
active subscription. No service API key is required. Keep credentials in approved
secret storage and approve external deployment only after reviewing the release
plan.

See `nativeui-plugin/README.md` and `nativeui-codex/README.md` for the full docs.
