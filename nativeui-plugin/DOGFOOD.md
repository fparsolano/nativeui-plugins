# NativeUI plugin — dogfood smoke checklist

The end-to-end smoke to validate a plugin **release** before shipping it. Run it from the repo root (or an
install of the plugin). One line per step → the expected result. `<bin>` = `nativeui-plugin/bin`. Stop at the
first step that doesn't meet its expectation. The plugin ships baked-in NativeUI service defaults targeting **dev**
(`dev.nativeui.com`), so there is **no configure step** — you just sign in.

| # | Step | Command / action | Expected result |
|---|---|---|---|
| 1 | **Install** | `/plugin marketplace add ./` then `/plugin install nativeui@nativeui-marketplace` (or `claude --plugin-dir ./nativeui-plugin`) | Plugin loads; `/nativeui:*` skills listed. |
| 2 | **Codex source check** | `node --test nativeui-plugin/test/codex-parity.test.mjs` | Passes; Claude `nativeui-developer` is byte-identical to the Codex canonical skill and the installer mirror includes the shared tools. |
| 3 | **Login (SSO)** | `node <bin>/login.mjs` — no config needed; open the printed URL + code, approve in browser | Prints `Logged in as <email>`; creds cached at `~/.nativeui/credentials.json` (0600). |
| 4 | **Preflight** | `node <bin>/preflight.mjs` | Prints `ok: <email>, subscription active`; exit 0 (requires an active subscription). |
| 5 | **Intake** | `node <bin>/nui-intake.mjs --prompt "responsive two-screen demo with detail page" -o nativeui-intake.json` | Writes a provenance bundle with responsive targets and no unresolved hard gaps for this prompt-only smoke. |
| 5a | **Delivery brief** | Choose a surface with `references/delivery-targets.md`: verify `mobile`→flagship, `web`→one of five lanes + static/SSR, or `desktop`→Rust; record exact target IDs | Choice, option tradeoffs, viewport/OS/browser scope, hosting/distribution, and any defaulted assumptions are explicit. The Apple-native macOS SwiftUI alternative is presented honestly as requiring a separately scoped/new `macos-swiftui` exporter; the iOS lane is never substituted. |
| 6 | **Design agent** | Use `nativeui-design` to create `nativeui-design-guide.md` from the prompt/intake: ask only unresolved delivery, responsive, parent-constraint, journey/state, and visual questions | Styling guide defines delivery targets, primary journey, tokens, motion, dynamic states, responsive matrix, and parent ownership/scroll/anchor rules before HTML authoring. |
| 7 | **Author** | Write 2 standalone HTML screens per `references/authoring-rules.md` and `nativeui-design-guide.md` (e.g. `home.html`, `detail.html`) — letter-first ids, an `<a href="#detail">` link, parent-relative flex/grid constraints, one `@keyframes`, and a content-derived `@media` only if the chosen flow needs structural reflow | Two valid HTML files on disk; no `<script>`/external `<link>`. |
| 8 | **Responsive + flow audit** | `node <bin>/nui-responsive-audit.mjs home.html detail.html` then `node <bin>/nui-flow-audit.mjs home.html detail.html` | Passes; generated screens have real responsive reflow, parent-owned constraints, navigation/actions, and complete relevant UX states. |
| 9 | **Import** | `node <bin>/nui-import.mjs home.html detail.html -o project.json` | Writes `project.json`; no `errors[]` (on errors it writes nothing + exits non-zero). |
| 10 | **Validate** | `node <bin>/nui-validate.mjs project.json` | Passes (service round-trip + structural); fails closed otherwise. |
| 11 | **Architecture gate** | Use `nativeui-architect` before backend scaffolding: audit repo/toolchain, ask only missing client target, web render/hosting, local run, origins/auth/cache, deploy/distribution and repo choices, write `nativeui-architecture.md` | Architecture record names exact target IDs, web static/SSR/runtime when relevant, stack, local command/port, frontend/backend hosts, routes, origins/cookies/cache, repo path, secrets policy, distribution, and approval state. |
| 12 | **Register API/DB library items** | `node <bin>/nui-library.mjs upsert-api project.json --name demo_api --path /api/demo --method GET` and store any secret only with `put-secret --secret-stdin` | `project.json` gains non-secret `libraryItems[]` metadata; API keys/passwords are absent from project/source/logs. |
| 13 | **Export (prod default)** | `node <bin>/nui-export.mjs project.json --target <selected-target-or-group> -o ./native-out`; include a web smoke such as `--target web-react` when that lane is selected | Clean runnable project(s), schema-2 manifests, authored web sources, and declared durable seams; no parity instrumentation. |
| 14 | **Export (beta/capture)** | Repeat a selected native lane with `--beta`; use `--all-targets` only as the exhaustive plugin release gate | Beta capture output is kept separate from normal product delivery and every unavailable gate is reported. |
| 15 | **Run locally** | `node <bin>/nui-run.mjs project.json --target <selected-target-or-group> [--render-mode static\|ssr]`; separately use `--all-targets` for exhaustive dogfood | Builds and launches each locally available selected host; direct routes/client navigation, animation, responsive constraints, flows, and PWA behavior are checked. Reports unavailable toolchains without hiding them. |
| 16 | **Connect (durable seams)** | `node <bin>/nui-connectors-plan.mjs project.json --target <selected-target-or-group> --human`, then wire one tap/API through every selected manifest-declared seam | Equivalent behavior runs in every selected target; generated UI stays untouched; web uses app-actions/data-adapters/custom-components rather than a model interpreter. |
| 17 | **Final review** | `node <bin>/nui-final-review.mjs --project project.json --html home.html detail.html --intake nativeui-intake.json --instructions user-instructions.md --target <id> --target-dir <id>=./native-out/<id> --human` (repeat target pairs) | Passes or fails with actionable findings before handoff; silent target drops, fixed shells, dead controls, and banned authored-web artifacts fail review. |
| 18 | **Guarded sync** | `node <bin>/nui-project-sync.mjs status project.json --name "Smoke Demo"` before edits; use `pull`/`push` only when status is clean | Detects stale cloud edits before the agent writes; `push` uses `expectedRevision` and fails closed on 409. |
| 19 | **Update one screen** | Re-author one screen's HTML → responsive audit → re-import the full set → re-export (skill: nativeui-update, with `nativeui-design` for redesign/inert or non-responsive sources) | Only that stage's `rootNodes` change; other screens intact; `NuiBackend.*` and `*BackendConnector.*` survive untouched. |
| 20 | **(beta) Report a parity delta** | If a beta render diverges from the editor: `node <bin>/nui-report-parity.mjs --title "..." --framework ios --delta '{...}'` | Delta filed to the bugs API; surfaces a new exporter gap (does not block the release). |
| 21 | **Logout** | `node <bin>/logout.mjs` | Cached creds removed; a later `preflight.mjs` reports not-logged-in. |

Notes
- No configuration is required (NativeUI dev hosts are baked into `config.mjs`; identity-provider keys stay
  server-side in profile-api); to target a different environment (self-host / prod), optionally override
  per-field via `~/.nativeui/config.json` or `NATIVEUI_*`.
- Steps 3–4, 9–14, 18, 20 require the dev SSO/profile + export + bugs endpoints (all deployed). Sign-in is
  **SSO-only** (`login.mjs` auto-opens + pastes the code-prefilled `/device` link).
- A clean **prod** export is parity-correct by construction (validated exporter); see the SKILL's
  "Verifying your output" → prod-quality guarantee.
