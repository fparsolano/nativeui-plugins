# NativeUI plugins

Public install mirror for the **NativeUI** agent integrations — build native iOS +
Android apps by turning prompts/references into a design guide, importing plain
HTML/CSS to a NativeUI project, exporting native screens, and wiring backend
through approved architecture plus `NuiBackend`, without hand-writing
SwiftUI/UIKit/Compose/XML.

This repo exposes **only the plugins** (it is synced from a private monorepo). It
contains the Claude Code plugin, the Codex marketplace plugin, the design/architect
agent contracts, and marketplace manifests.

Hosted NativeUI import/export requires **NativeUI beta access** and an active
subscription. The plugin can also point at an approved internal/self-host export
service for enterprise tenant-policy fallback.

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

## Setup (both)

1. No local API keys are required; identity-provider keys stay server-side in NativeUI profile-api.
2. Sign in (browser SSO): `node ~/.codex/skills/nativeui/bin/login.mjs` (Codex) — the Claude plugin prompts via its skill.
3. NativeUI beta access plus an active subscription is required for hosted import/export.

See `nativeui-plugin/README.md` and `nativeui-codex/README.md` for the full docs.
