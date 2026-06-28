---
name: nativeui-architect
description: >-
  NativeUI backend/deployment architecture agent. Use before nativeui-backend or major functionality work when
  the user needs a backend, API, database, auth, local dev setup, deployment target, repository layout, or
  infrastructure decision; when no existing backend/codebase is supplied; or when an existing repo should be
  audited before scaffolding. Audits current project structure, asks how the backend should run locally and
  eventually deploy, writes nativeui-architecture.md, and only implements backend/deploy automation after user
  approval.
metadata:
  argument_hint: "[project.json, repo, or backend request]"
allowed-tools: "Read Write Edit Glob Grep Bash(node ${CLAUDE_SKILL_DIR}/../../bin/*) Bash(node */nativeui-plugin/bin/*) Bash(git*) Bash(npm*) Bash(node*) Bash(python3*) Bash(docker*) Bash(gcloud*) Bash(fly*) Bash(flyctl*) Bash(railway*) Bash(render*) Bash(vercel*) Bash(netlify*)"
---

# NativeUI architect agent

Use this skill as the architecture gate before creating or changing the backend. It decides *what shape the
backend/deployment should take* before `nativeui-backend` scaffolds it and before `nativeui-developer` wires app
functionality to both native exports.

## When To Run

Run this when:
- the app needs APIs, a database, auth, server-side secrets, webhooks, scheduled jobs, storage, or backend
  deployment;
- the user has no preexisting backend, repo, or local setup;
- the user supplied a repo/codebase and you need to audit the current backend/deployment shape before changing it;
- the user asks what backend to use, where it should live, how to run locally, or how to deploy;
- `nui-backend-plan.mjs` finds backend-routed actions and no approved `nativeui-architecture.md` exists.

Skip only when the user explicitly points at an already-approved architecture decision and asks for the next
implementation step.

## 1. Audit First

Inspect the project before recommending a stack:
```bash
rg --files \
  -g 'package.json' -g 'pyproject.toml' -g 'requirements.txt' \
  -g 'Dockerfile' -g 'docker-compose.yml' \
  -g 'firebase.json' -g 'supabase/**' \
  -g 'fly.toml' -g 'railway.json' -g 'render.yaml' \
  -g 'vercel.json' -g 'netlify.toml' \
  -g '!node_modules/**' -g '!build/**' -g '!target/**'
```

Also inspect `project.json` when present:
```bash
node ${CLAUDE_SKILL_DIR}/../../bin/nui-backend-plan.mjs project.json --human
node ${CLAUDE_SKILL_DIR}/../../bin/nui-connectors-plan.mjs project.json --human
```

Summarize what exists:
- repo shape: monorepo, app-only repo, backend folder, generated native exports, package managers;
- backend evidence: routes, functions, Docker, BaaS config, DB clients, migrations, auth libraries;
- deployment evidence: Cloud Run, Fly, Railway, Render, Vercel, Netlify, Firebase, Supabase, VPS/Docker;
- local dev commands and ports;
- secret/config strategy and any risky committed values;
- gaps that block a safe recommendation.

Do not create files or choose a stack during the audit.

## 2. Ask The Architecture Brief

Ask only the missing questions. Keep them short:
- **Local backend:** mock server, Node/Hono, Python/FastAPI, Docker Compose, Supabase, Firebase, or existing
  service?
- **Deployment:** Cloud Run, Fly, Railway, Render, Vercel, Netlify, Firebase/Supabase, VPS/Docker, or undecided?
- **Repository shape:** same repo `backend/`, separate backend repo, monorepo package, or generated starter only?
- **Data/auth:** database provider, auth provider, storage/files, webhooks/jobs, admin tooling, seed data?
- **Secrets:** which values are server-side only, and where should they live locally and in deploy secret stores?
- **Environments:** local/dev/prod base URLs, preview branches, and who owns deploy credentials?

If the user asks you to continue without answers, make conservative assumptions and mark them as assumptions in
the architecture file. Do not deploy without explicit approval.

## 3. Write `nativeui-architecture.md`

Create or update this decision record before implementation. Start from the deterministic scaffold when the
file does not already exist:
```bash
node ${CLAUDE_SKILL_DIR}/../../bin/nui-architecture.mjs init -o nativeui-architecture.md --project project.json
```

Include:
- audit summary and existing constraints;
- recommended stack and one or two alternatives, with tradeoffs;
- local run plan: command, port, env file name, seed/mock strategy, Android emulator URL, iOS simulator URL;
- deployment plan: target, region/provider, config files to create, health check, expected production URL shape;
- repository layout: where backend code and deploy config will live;
- API/database/auth contract: route list from `nui-backend-plan`, tables/collections, auth/session model;
- secret policy: env var names only, local `.env` ignored, deploy secret store, no secrets in source/project/native code;
- NativeUI wiring plan: registered library items, connector classes, base URL switch, both Android + iOS;
- implementation phases and approval checkbox.

End the file with:
```markdown
## Approval
- [ ] User approved this architecture for implementation.
```

## 4. Get Approval Before Automation

Show the recommendation and ask for approval before scaffolding, deploying, or editing connector code. Approval
can be explicit in chat or by checking the approval box in `nativeui-architecture.md`.

After approval:
- verify the checked decision record with
  `node ${CLAUDE_SKILL_DIR}/../../bin/nui-architecture.mjs check nativeui-architecture.md --require-approved`;
- use `nativeui-backend` to scaffold the chosen server/deploy automation in the selected repo path;
- use `nativeui-developer` / `nativeui-connect` to register API/database surfaces and wire both native targets;
- preserve existing backend code and extend it in place when a backend already exists;
- update `BACKEND.md` after implementation with the actual run/deploy commands.

## Hard Rules

- Do not silently pick a backend stack, deployment provider, repo shape, or secret strategy.
- Do not deploy or create provider resources without approval.
- Do not put secrets in `project.json`, source files, command arguments, logs, generated native code, or docs.
- Do not touch generated native files or NativeUI importer/exporter code.
- Keep architecture decisions aligned with both native targets: every API/database behavior must be callable from
  Android and iOS through matching connector behavior.
