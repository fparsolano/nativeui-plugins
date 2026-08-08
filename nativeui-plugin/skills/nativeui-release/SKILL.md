---
name: nativeui-release
description: >-
  Diagnose, build, validate, package, upload, and deploy NativeUI exports for SwiftUI, UIKit,
  Compose, Android Views, Rust, C#, and web/PWA targets. Use for local toolchain readiness,
  release planning, signed artifacts, store uploads, static deployment, or all-target release work.
metadata:
  argument_hint: "plan|build|validate|upload|deploy --target <target-id|group>"
allowed-tools: "Bash(node ${CLAUDE_SKILL_DIR}/../../bin/*) Bash(node */nativeui-plugin/bin/*) Bash(dotnet*) Bash(cargo*) Bash(gradle*) Bash(./gradlew*) Bash(xcodebuild*) Bash(xcrun*) Bash(fastlane*) Bash(vercel*) Bash(netlify*) Read Glob"
---

# NativeUI release workflow

Use `<bin>` as `${CLAUDE_SKILL_DIR}/../../bin`.

Before doctor/build, resolve only missing release decisions from
`../nativeui/references/delivery-targets.md`: exact targets and version/environment; web lane plus static/SSR,
provider/runtime, region/domain/base path, preview versus production, environment variables and offline/update
policy; mobile bundle IDs, stores and signing ownership; desktop OS/CPU/package, signing/notarization and update
channel. Record the choice and do not imply an unsupported provider adapter exists.

Start with a read-only readiness report:

```bash
node <bin>/nui-doctor.mjs --target <target-id-or-group> --release --human
node <bin>/nui-doctor.mjs --all-targets --release --json
```

Resolve required blockers for selected targets; optional provider CLIs are needed only for the chosen
deployment route. Then plan and build:

```bash
node <bin>/nui-release.mjs plan --project <export-dir> --target <target-id> --human
node <bin>/nui-release.mjs build --project <export-dir> --target <target-id>
node <bin>/nui-release.mjs validate --project <export-dir> --target <target-id>
node <bin>/nui-release.mjs build --project <export-dir> --target web-astro --render-mode ssr
```

Web release builds default to `--render-mode static`. React, Vue, Angular, and Astro also accept `ssr`;
the dependency-free HTML lane remains static-only.

Here `static` means prerendered build output for static asset hosting. It does not mean an inert page: the
release must retain every applicable manifest capability, responsive parent constraint, interaction/state
flow, timeline, route, form/list behavior, and PWA/offline contract.

Static build/hosting is the recommended operational default for complete prerendered pages and CDN/PWA delivery. Select SSR
only for request-time HTML, personalization/auth, server data, or server-rendered SEO and only after confirming a
compatible Node/server runtime, start command, health check, API/cookie/CORS policy, and cache exclusions.

Treat `nativeui-export-manifest.json` as the archive contract for generated files, protected write-once
files, toolchains, and commands. Keep signing credentials in environment variables, protected local files,
or account secret storage. Never write them into project JSON, generated source, or output logs.

Uploads, deployments, notarization, and store submissions change external state. Show the plan and artifact
first, get explicit user approval, and only then use `upload`/`deploy` with `--confirm-external`. Web deploy
supports Vercel and Netlify adapters; mobile upload supports Play and App Store provider adapters. CI uses
plan/build/validate only and never supplies `--confirm-external`.
