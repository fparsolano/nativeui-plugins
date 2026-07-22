# NativeUI plugin toolchain

Dependency-free Node 18+ commands used by both plugin packages. Hosted commands use global `fetch`; local
capability, planning, doctor, merge, review, build, and test operations use built-in modules and installed
platform toolchains.

## Hosted setup

The default NativeUI dev hosts are built in. Hosted import/export/save/editor/library operations require browser
SSO and an active subscription:

```bash
node bin/login.mjs
node bin/preflight.mjs
```

Credentials are stored with restricted permissions in `~/.nativeui/credentials.json`. No Firebase or NativeUI
service API key is stored in plugin or user configuration. To use an approved self-hosted exporter, override
`exportServiceUrl` in `~/.nativeui/config.json` or `NATIVEUI_EXPORT_SERVICE_URL`; set `exportAuthMode: "none"`
only when that internal service intentionally permits it. Cloud account features still require NativeUI auth.

An unavailable hosted service blocks the hosted operation, not unrelated local inspection, authoring, doctor,
planning, build, test, or review work.

## Commands

| Area | Commands |
| --- | --- |
| Auth/config | `login`, `logout`, `token`, `preflight`, `config.mjs` |
| Intake/design | `nui-intake`, `nui-design-guide`, `nui-responsive-audit`, `nui-flow-audit` |
| Project | `nui-import`, `nui-validate`, `nui-save`, `nui-preview`, `nui-project-sync` |
| Editor | `nui-editor handoff|resume|publish`, `nui-screen-extract`, `nui-screen-update` |
| Granular nodes | `nui-fragment-extract`, `nui-fragment-import` |
| Capability/readiness | `nui-capabilities search|show|matrix`, `nui-doctor` |
| Logic/backend | `nui-library`, `nui-architecture`, `nui-backend-plan`, `nui-connectors-plan` |
| Delivery | `nui-export`, `nui-test-gen`, `nui-run`, `nui-final-review`, `nui-release` |
| Diagnostics | `nui-report-parity` |

Run any command with `--help`. Target-aware delivery commands accept `--target auto|<target-id|group>`,
repeated `--target`, or `--all-targets`. `auto` selects SwiftUI plus Compose. Legacy `--platform` aliases remain
compatible.

Contextual defaults are mobile=`ios-swiftui` + `android-compose`, web=`web-html` + static build/hosting, and
desktop=`rust-desktop`. Rust mobile provides a beta shared Rust runtime/action seam; C# mobile/desktop serves
.NET teams. Web owners can instead choose React Router, Nuxt/Vue, Angular, or Astro, each with static or SSR
delivery. Static mode retains responsive layout, dynamic flow, and every applicable manifest capability. For
desktop, also present macOS SwiftUI as an Apple-native alternative that requires a separately
scoped/new `macos-swiftui` exporter; none is currently registered, and `ios-swiftui` is not desktop output.

The target IDs are:

```text
ios-swiftui ios-uikit android-compose android-views
rust-desktop rust-ios rust-android rust-web
web-html web-react web-vue web-angular web-astro
csharp-desktop csharp-ios csharp-android
```

## Typical flow

```bash
node bin/nui-capabilities.mjs matrix --human
node bin/nui-doctor.mjs --target auto --human
node bin/nui-responsive-audit.mjs home.html settings.html
node bin/nui-flow-audit.mjs home.html settings.html
node bin/nui-import.mjs home.html settings.html -o project.json
node bin/nui-responsive-audit.mjs project.json
node bin/nui-flow-audit.mjs project.json
node bin/nui-editor.mjs handoff project.json --name "My App"
node bin/nui-screen-extract.mjs project.json --stage home -o home.html
node bin/nui-screen-update.mjs project.json --stage home --html home.html
node bin/nui-connectors-plan.mjs project.json --target auto --human
node bin/nui-export.mjs project.json --target auto -o ./native-out
node bin/nui-test-gen.mjs project.json --target auto --out ./native-out
node bin/nui-run.mjs project.json --target auto -o ./native-out
node bin/nui-final-review.mjs --project project.json --target auto --human
node bin/nui-release.mjs plan project.json --target auto
```

Every full export archive contains `nativeui-export-manifest.json`. It names generated files, write-once seams,
capability dispositions, toolchain requirements, and run/test/release commands. Extraction stages the archive,
refreshes generated files, preserves existing seams, and writes changed generated seam stubs as `.new`.

Clean/prod is the default. `--beta` is internal parity instrumentation. External upload, deployment,
notarization, and store submission require both explicit user approval and `--confirm-external`. Signing secrets
must come from environment variables, protected files, platform stores, or account secret storage and are never
embedded in project JSON or logs.

## Tests

From `nativeui-plugin/` run `npm test`. The suite checks parsing, fail-closed network behavior, capability
coverage, merge preservation, editor conflict states, target plans, generated package freshness, and secret-safe
release guards. CI also runs `node --check` on every `bin/*.mjs`.
