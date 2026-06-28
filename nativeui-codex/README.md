# NativeUI for Codex

The **OpenAI Codex** port of the NativeUI agent integration, shipped as a set of **Codex skills**. It lets Codex
build native iOS + Android apps with NativeUI: write plain HTML/CSS, import it to a NativeUI project, export
native screens, run them on a local emulator/simulator, and wire backend through the `NuiBackend` interface —
without writing SwiftUI/UIKit/Compose/XML by hand.

This package is now the **Codex-first source of truth** for NativeUI developer-agent behavior. Claude Code is a
mirrored distribution target: the canonical developer-agent contract lives under
`nativeui-codex/canonical/nativeui-developer/SKILL.md`, and the Claude plugin carries a byte-for-byte mirror that
is checked by tests. The current Codex installer flow is unchanged: it still installs the shared skill/toolchain
tree after the Claude mirror has been synced.

- **Skills:** the portable `SKILL.md`s + reference docs + gold examples at `../nativeui-plugin/skills/*`.
  `SKILL.md` is a cross-agent standard, so the *same* skills are valid Codex skills — the installer copies them
  into your Codex skills dir and rewrites their tool/reference paths to absolute paths (Codex doesn't set
  `CLAUDE_SKILL_DIR`). The plugin installs every discovered NativeUI skill because they cross-reference each
  other:
  - `nativeui` — the primary playbook (auth → author → import → export → connect → iterate) plus the reference
    docs (`authoring-rules`, `backend-contract`, `project-model`) and gold examples.
  - `nativeui-intake` — normalizes PDF/image/Figma/source/HTML inputs and audits responsiveness before import.
  - `nativeui-design` — design agent for prompt/non-HTML/plain-static HTML sources: asks the responsive
    portrait/landscape/UX brief, creates `nativeui-design-guide.md`, and defines the styling guide, animation
    system, and responsive direction before HTML authoring.
  - `nativeui-architect` — backend/deployment architecture gate: audits existing repos, asks how the backend
    should run locally and eventually deploy, writes `nativeui-architecture.md`, and waits for approval.
  - `nativeui-developer` — the Codex-owned functionality orchestrator: mobile = iOS + Android, web is
    unsupported for v1, API/DB surfaces are registered as library items, secrets are account-scoped, project
    saves are sync-guarded, repeater data sources stay registered/non-secret, and native connector behavior
    must be mirrored.
  - `nativeui-app`, `nativeui-import`, `nativeui-export`, `nativeui-run`, `nativeui-connect`, `nativeui-review`,
    `nativeui-backend`, `nativeui-test`, `nativeui-update` — the driving/review skills the primary playbook
    points at ("see the nativeui-run skill", etc.). Installing the full discovered set keeps those
    cross-references resolvable, so no capability is lost.
- **Toolchain:** the agent-agnostic, pure-Node scripts at `../nativeui-plugin/bin/*.mjs` (`preflight`, `login`,
  `nui-intake`, `nui-responsive-audit`, `nui-import`, `nui-validate`, `nui-export`, `nui-run`, `nui-save`,
  `nui-preview`, `nui-design-guide`, `nui-architecture`, `nui-backend-plan`, `nui-connectors-plan`,
  `nui-final-review`, `nui-test-gen`,
  `nui-fragment-import/extract`, `nui-project-sync`, `nui-library`, `nui-report-parity`). They default to `https://dev.nativeui.com`
  and **fail closed** on auth (logged in **and** active subscription). The install copies them **once** to
  `<skills-dir>/nativeui/bin` (travels with the primary skill); every skill's rewritten commands point at that
  one shared bin dir.

> Layout assumption: `nativeui-codex/` sits next to `nativeui-plugin/` in the same checkout. If the plugin lives
> elsewhere, set `NATIVEUI_PLUGIN_DIR` (see Install).

## Prerequisites

- **Node 18+** on your PATH (the toolchain is pure Node, no npm deps to install).
- **OpenAI Codex** with skills support.
- **NativeUI beta access** plus a NativeUI account with an **active subscription** (hosted import/export fail closed without it).

## Install

### Option A — Codex plugin marketplace (primary)

Build or refresh the repo-local Codex plugin artifact:

```bash
node nativeui-codex/build-codex-plugin.mjs
```

Then add this repo as a marketplace and install the plugin:

```bash
codex plugin marketplace add ./
codex plugin add nativeui@nativeui-marketplace
```

The generated marketplace lives at `.agents/plugins/marketplace.json` and points
at `plugins/nativeui`. The plugin contains the NativeUI skills, pure-Node
toolchain, and admin policy kit.

After install, start a new Codex thread so Codex discovers the plugin skills.

### Option B — legacy skill installer

```bash
bash nativeui-codex/install.sh
```

This direct skill-copy installer remains for manual fallback and older setups.
It is idempotent (a re-run re-copies a fresh tree). It:

1. **Resolves** the shared plugin (`../nativeui-plugin` by default) and the Codex skills dir
   (`~/.codex/skills` by default).
2. **Copies every skill** — each `nativeui-plugin/skills/<name>` → `<skills-dir>/<name>` (SKILL.md + any
   references/ examples/ templates/), and the **toolchain** `nativeui-plugin/bin` **once** →
   `<skills-dir>/nativeui/bin`. The bin is dependency-free, so there's nothing to `npm install`.
3. **Rewrites the copies only** so Codex can run them: for each installed skill, in its `SKILL.md` and every
   `*.md` it contains, it replaces `${CLAUDE_SKILL_DIR}/../../bin` → the single absolute shared **bin** dir, then
   `${CLAUDE_SKILL_DIR}` → **that skill's own** absolute install dir (so each skill's references/examples — and
   the `../sibling` cross-skill references — resolve to the right installed dir). The shared originals under
   `nativeui-plugin/` are **never** touched.
4. **Needs no config** — the toolchain ships baked-in PUBLIC dev defaults, so there's nothing to set. It drops a
   blank `~/.nativeui/config.json` override template (only if absent) purely as a convenience for targeting
   another environment later, then prints the finish steps (the only step that matters is SSO sign-in).

After install, **restart Codex (or open a new chat)** so it discovers the new skills.

### Overrides

| Env var | What it does | Default |
| --- | --- | --- |
| `CODEX_SKILLS_DIR` | Where to install the skills. | `~/.codex/skills` |
| `NATIVEUI_PLUGIN_DIR` | Where the shared `nativeui-plugin` checkout lives (its `skills/` + `bin/`). | `../nativeui-plugin` (sibling) |

```bash
# Install into the alternative Codex skills location:
CODEX_SKILLS_DIR="$HOME/.agents/skills" bash nativeui-codex/install.sh

# Non-sibling plugin checkout:
NATIVEUI_PLUGIN_DIR=/path/to/nativeui-plugin bash nativeui-codex/install.sh
```

`~/.codex/skills` is preferred; **`~/.agents/skills` is also a valid Codex skills directory** — use
`CODEX_SKILLS_DIR` to target it.

## One-time NativeUI setup — none, just sign in (SSO)

**No configuration is required.** The `bin/` toolchain ships baked-in NativeUI dev hosts, and
identity-provider keys stay server-side in profile-api, so a normal user configures **nothing**. The only setup
is a browser SSO sign-in, and an **active subscription** is required. There is **no `config.toml` / MCP setup**
in the skills model.

1. **Sign in — SSO only.** Sign-in is **browser SSO; there is no password method** for users. Run
   `node <skills-dir>/nativeui/bin/login.mjs` (the installed `SKILL.md` prints the absolute path). It requests a
   device code, best-effort auto-opens the code-prefilled `https://dev.nativeui.com/device?userCode=…` page, and
   polls until you approve in the browser where you're already signed in. The server brokers the CLI session, so
   no Firebase/API key is stored locally. If the browser doesn't open, use the printed URL + 8-char code
   (already filled in) and press **Authorize**.
2. **Verify.** Run `node <skills-dir>/nativeui/bin/preflight.mjs`. It must print `ok: <email>, subscription
   active` before import or export will work. If it fails, it prints the exact remedy (sign in / subscribe) —
   follow it.

**Optional override (only for a different environment).** To point the toolchain at a non-default environment
(self-host / prod), set the fields you want in **`~/.nativeui/config.json`** (or `NATIVEUI_*` env vars) — the same
file the Claude Code plugin uses. Resolution is **defaults ← `~/.nativeui/config.json` ← `NATIVEUI_*` env**
(per-field). See `../nativeui-plugin/bin/README.md`.

If a tenant policy blocks uploads to `dev.nativeui.com`, the plugin cannot grant that access itself. Use the
Codex package admin policy kit to approve NativeUI import/export, or configure an approved internal/self-host
export service:

```json
{
  "exportServiceUrl": "https://nativeui-export.internal.example.com",
  "exportAuthMode": "none"
}
```

Export-only mode is only for that approved internal service path; NativeUI cloud save/preview/sync/library
secrets still require hosted NativeUI auth.

## Use it

In Codex:

- **Just describe the app** — "build me a 3-screen trips app with a dark theme". Codex loads the `nativeui`
  skill implicitly and follows the workflow (auth → plan → author HTML/CSS → import → export iOS + Android).
- Run **`/skills`** and pick **`nativeui-developer`** for functionality work, **`nativeui`** for the primary
  app-building playbook, or one of the driving skills
  (`nativeui-intake`, `nativeui-design`, `nativeui-architect`, `nativeui-app`, `nativeui-import`,
  `nativeui-export`, `nativeui-run`, `nativeui-connect`, `nativeui-review`, `nativeui-backend`,
  `nativeui-test`, `nativeui-update`) for a single step.
- Invoke by name: **`$nativeui build me a habit tracker`**.

The skills drive the same `bin/` scripts the Claude Code plugin uses, so behavior is identical across agents.
Always-on orientation lives in [`AGENTS.md`](AGENTS.md) (install it as your repo or `~/.codex/AGENTS.md` if you
want the workflow loaded without invoking a skill — optional; the `nativeui` skill carries the full playbook
itself).

## Layout

```
nativeui-codex/
├─ README.md      ← this file
├─ AGENTS.md      ← always-on Codex orientation (optional; the nativeui skill carries the full playbook)
└─ install.sh     ← idempotent skill installer (copies all shared skills + bin once, rewrites paths)
```

The canonical developer-agent contract lives in `nativeui-codex/canonical/`. The installable skills + toolchain
are mirrored into `../nativeui-plugin/` for Claude distribution and then copied into your Codex skills dir at
install time.

The verification mandate is unchanged from the engine: quality comes from the **validated exporter** (held at
zero per-node deltas across editor == web == iOS == Android), a clean `--prod` export renders faithfully by
construction, and unsupported CSS features degrade **silently** on import — author within the supported surface
in `authoring-rules.md` and treat import `errors[]` as hard failures.
