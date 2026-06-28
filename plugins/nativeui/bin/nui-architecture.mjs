#!/usr/bin/env node
// nui-architecture.mjs - scaffold/check a NativeUI backend/deployment decision record.
//
// Usage:
//   node bin/nui-architecture.mjs init -o nativeui-architecture.md [--project project.json] [--stack "..."] [--deployment "..."] [--force]
//   node bin/nui-architecture.mjs check nativeui-architecture.md [--require-approved]

import { promises as fs } from 'node:fs';
import path from 'node:path';

class ArchitectureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArchitectureError';
  }
}

const USAGE = 'Usage: node bin/nui-architecture.mjs init -o nativeui-architecture.md [--project project.json] [--stack "..."] [--deployment "..."] [--force] | check nativeui-architecture.md [--require-approved]';
const REQUIRED_HEADINGS = [
  'Audit Summary',
  'Recommended Stack',
  'Alternatives',
  'Local Run Plan',
  'Deployment Plan',
  'Repository Layout',
  'API Database Auth Contract',
  'Secret Policy',
  'NativeUI Wiring Plan',
  'Implementation Phases',
  'Approval',
];

function parseArgs(argv) {
  const command = argv[0] || '';
  if (!['init', 'check'].includes(command)) throw new ArchitectureError(USAGE);
  let out = '';
  let file = '';
  let project = '';
  let stack = '';
  let deployment = '';
  let force = false;
  let requireApproved = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') {
      out = argv[++i] || '';
    } else if (a === '--project') {
      project = argv[++i] || '';
    } else if (a === '--stack') {
      stack = argv[++i] || '';
    } else if (a === '--deployment') {
      deployment = argv[++i] || '';
    } else if (a === '--force') {
      force = true;
    } else if (a === '--require-approved') {
      requireApproved = true;
    } else if (a === '-h' || a === '--help') {
      throw new ArchitectureError(USAGE);
    } else if (a.startsWith('-')) {
      throw new ArchitectureError(`Unknown flag: ${a}\n${USAGE}`);
    } else if (!file) {
      file = a;
    } else {
      throw new ArchitectureError(`Unexpected argument: ${a}\n${USAGE}`);
    }
  }
  if (command === 'init' && !out) throw new ArchitectureError(`Missing -o/--out.\n${USAGE}`);
  if (command === 'check' && !file) throw new ArchitectureError(`Missing architecture file path.\n${USAGE}`);
  return { command, out, file, project, stack, deployment, force, requireApproved };
}

async function initArchitecture(opts) {
  const outPath = path.resolve(opts.out);
  if (!opts.force) {
    try {
      await fs.stat(outPath);
      throw new ArchitectureError(`${outPath} already exists. Re-run with --force to overwrite.`);
    } catch (e) {
      if (e instanceof ArchitectureError) throw e;
    }
  }
  const project = opts.project ? path.resolve(opts.project) : 'Not supplied.';
  const stack = opts.stack.trim() || 'Undecided until audit/user approval.';
  const deployment = opts.deployment.trim() || 'Undecided until audit/user approval.';
  const content = `# NativeUI Architecture

## Audit Summary
- Project: ${project}
- Existing backend/deploy evidence:
- Constraints:
- Gaps:

## Recommended Stack
- Stack: ${stack}
- Reason:
- Tradeoffs:

## Alternatives
- Alternative 1:
- Alternative 2:

## Local Run Plan
- Command:
- Port:
- Env file:
- Seed/mock strategy:
- iOS simulator URL:
- Android emulator URL:

## Deployment Plan
- Target: ${deployment}
- Region/provider:
- Config files:
- Health check:
- Production URL shape:

## Repository Layout
- Backend path:
- Deploy config path:
- Shared package/config path:

## API Database Auth Contract
- Routes:
- Tables/collections:
- Auth/session model:

## Secret Policy
- Env var names only:
- Local ignored files:
- Deploy secret store:
- Source/project/native-code exclusions:

## NativeUI Wiring Plan
- Registered API/database library items:
- Android connector classes:
- iOS connector classes:
- Base URL switch:

## Implementation Phases
- Phase 1:
- Phase 2:
- Phase 3:

## Approval
- [ ] User approved this architecture for implementation.
`;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, content);
  process.stdout.write(`Wrote architecture record -> ${outPath}\n`);
}

function isApproved(text) {
  return /^-\s*\[[xX]\]\s*User approved this architecture for implementation\.\s*$/m.test(text)
    || /^Approved:\s*(yes|true)\s*$/mi.test(text);
}

async function checkArchitecture(file, requireApproved) {
  const full = path.resolve(file);
  const text = await fs.readFile(full, 'utf8').catch((e) => {
    throw new ArchitectureError(e.code === 'ENOENT' ? `Architecture file not found: ${file}` : `Could not read ${file}: ${e.message}`);
  });
  const missing = REQUIRED_HEADINGS.filter((heading) => !new RegExp(`^##\\s+${heading}\\s*$`, 'mi').test(text));
  if (missing.length) {
    throw new ArchitectureError(`Architecture file is missing required section(s): ${missing.join(', ')}`);
  }
  if (requireApproved && !isApproved(text)) {
    throw new ArchitectureError('Architecture file is present but not approved. Check the approval box before backend automation or final handoff.');
  }
  process.stdout.write(`ok: architecture record has ${REQUIRED_HEADINGS.length} required sections${requireApproved ? ' and approval' : ''}\n`);
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.command === 'init') await initArchitecture(opts);
    else await checkArchitecture(opts.file, opts.requireApproved);
  } catch (err) {
    process.stderr.write((err && err.message ? err.message : String(err)) + '\n');
    process.exit(1);
  }
}

main();
