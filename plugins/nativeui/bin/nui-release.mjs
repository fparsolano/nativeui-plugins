#!/usr/bin/env node
// Plan, build, validate, and approval-gate release/deployment actions per target.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveTargets } from './target-contract.mjs';
import {
  ExportManifestError,
  discoverExportManifests,
  readExportManifest,
  resolveManifestTargetRoots,
  validateWebArtifacts,
  webArtifactLayout,
} from './export-manifest.mjs';

const USAGE = 'Usage: node bin/nui-release.mjs plan|build|validate|upload|deploy --project <exported-dir> [--target auto|<id|group>...] [--all-targets] [--render-mode static|ssr] [--artifact <path>] [--provider vercel|netlify|play|app-store] [--confirm-external] [--json|--human]';

function parseArgs(argv) {
  const command = argv.shift();
  if (!['plan', 'build', 'validate', 'upload', 'deploy'].includes(command)) throw new Error(USAGE);
  const tokens = [];
  let project = '';
  let artifact = '';
  let provider = '';
  let confirmExternal = false;
  let format = 'human';
  let allTargets = false;
  let renderMode = 'static';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project') project = argv[++i] || '';
    else if (arg === '--target') tokens.push(argv[++i] || '');
    else if (arg === '--all-targets') allTargets = true;
    else if (arg === '--render-mode') renderMode = (argv[++i] || '').toLowerCase();
    else if (arg === '--artifact') artifact = argv[++i] || '';
    else if (arg === '--provider') provider = argv[++i] || '';
    else if (arg === '--confirm-external') confirmExternal = true;
    else if (arg === '--json') format = 'json';
    else if (arg === '--human') format = 'human';
    else if (arg === '-h' || arg === '--help') throw new Error(USAGE);
    else throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
  }
  const targets = resolveTargets(tokens, { allTargets, defaults: true });
  if (!['static', 'ssr'].includes(renderMode)) throw new Error(`--render-mode must be static|ssr.\n${USAGE}`);
  if (!project || !targets.length) throw new Error(USAGE);
  if (['upload', 'deploy'].includes(command) && !confirmExternal) throw new Error(`${command} changes external state; re-run with --confirm-external after reviewing the plan.`);
  return { command, project: path.resolve(project), targets, artifact: artifact ? path.resolve(artifact) : '', provider, confirmExternal, format, renderMode };
}

function find(root, predicate, maxDepth = 5, depth = 0) {
  if (depth > maxDepth || !fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...find(full, predicate, maxDepth, depth + 1));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function findDirectories(root, predicate, maxDepth = 5, depth = 0) {
  if (depth > maxDepth || !fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (predicate(full)) out.push(full);
    out.push(...findDirectories(full, predicate, maxDepth, depth + 1));
  }
  return out;
}

function currentRid() {
  if (process.env.NUI_RELEASE_RID) return process.env.NUI_RELEASE_RID;
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'osx-arm64' : 'osx-x64';
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'win-arm64' : 'win-x64';
  return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
}

function generatedAppProject(project) {
  return find(project, (file) => file.endsWith('.csproj') && !file.includes(`${path.sep}Runtime${path.sep}`), 3)[0] || '';
}

export function planFor(target, project, opts = {}) {
  const id = target.id;
  const base = { targetId: id, releaseStatus: target.releaseStatus };
  const renderMode = opts.renderMode || target.defaultRenderMode || 'static';
  if (id.startsWith('android-')) {
    const gradlew = find(project, (file) => path.basename(file) === 'gradlew', 4)[0] || './gradlew';
    return { ...base, build: [gradlew, 'bundleRelease'], artifacts: ['**/*.aab'], upload: ['fastlane', 'supply'] };
  }
  if (id.startsWith('ios-')) {
    const xcodeproj = findDirectories(project, (dir) => dir.endsWith('.xcodeproj'), 4)[0];
    const args = xcodeproj ? ['xcodebuild', '-project', xcodeproj, '-scheme', path.basename(xcodeproj, '.xcodeproj'), '-configuration', 'Release', 'archive'] : ['xcodebuild', 'archive'];
    return { ...base, build: args, artifacts: ['**/*.xcarchive', '**/*.ipa'], upload: ['xcrun', 'altool/Transporter'] };
  }
  if (id === 'web-html') {
    if (renderMode === 'ssr') throw new Error('web-html supports only --render-mode static.');
    const layout = webArtifactLayout(project, id, 'static');
    return {
      ...base,
      renderMode: 'static',
      build: [],
      artifacts: layout.requiredFiles,
      staticOutputDir: layout.clientDir,
      deploy: ['vercel', 'netlify'],
      deployment: { automated: true, supportedProviders: ['vercel', 'netlify'], directory: layout.clientDir },
    };
  }
  if (id.startsWith('web-')) {
    const layout = webArtifactLayout(project, id, renderMode);
    const isStatic = renderMode === 'static';
    return {
      ...base,
      renderMode,
      build: ['pnpm', `build:${renderMode}`],
      artifacts: layout.requiredFiles,
      staticOutputDir: isStatic ? layout.clientDir : '',
      clientOutputDir: layout.clientDir,
      deploy: isStatic ? ['vercel', 'netlify'] : [],
      deployment: isStatic
        ? { automated: true, supportedProviders: ['vercel', 'netlify'], directory: layout.clientDir }
        : {
            automated: false,
            supportedProviders: [],
            target: 'Node application host',
            reason: 'Generated SSR projects do not include a provider-specific deployment adapter.',
          },
    };
  }
  if (id === 'rust-desktop') {
    const script = process.platform === 'darwin' ? 'scripts/build-macos.sh' : process.platform === 'win32' ? 'scripts/build-windows.sh' : 'scripts/build-linux.sh';
    return { ...base, build: fs.existsSync(path.join(project, script)) ? [script] : ['cargo', 'build', '--release'], artifacts: ['*.app', '*.exe', '*.AppImage', '*.deb', '*.rpm', '*.tar.gz'] };
  }
  if (id === 'rust-web') return { ...base, build: fs.existsSync(path.join(project, 'scripts/build-web.sh')) ? ['scripts/build-web.sh'] : ['cargo', 'build', '--release', '--target', 'wasm32-unknown-unknown'], artifacts: ['**/*.wasm', 'index.html'] };
  if (id === 'rust-ios' || id === 'rust-android') return { ...base, build: [`scripts/build-${id.endsWith('ios') ? 'ios' : 'android'}.sh`], artifacts: [id.endsWith('ios') ? '**/*.ipa' : '**/*.aab'] };
  if (id === 'csharp-desktop') {
    const appProject = generatedAppProject(project);
    return { ...base, build: ['dotnet', 'publish', ...(appProject ? [appProject] : []), '-c', 'Release', '-r', currentRid(), '--self-contained', 'true'], artifacts: ['**/publish/**'] };
  }
  if (id === 'csharp-ios') return { ...base, build: ['dotnet', 'publish', path.join(project, 'Runtime/Nui.Rt.iOS/Nui.Rt.iOS.csproj'), '-f', 'net10.0-ios', '-c', 'Release'], artifacts: ['**/*.ipa'] };
  if (id === 'csharp-android') return { ...base, build: ['dotnet', 'publish', path.join(project, 'Runtime/Nui.Rt.Android/Nui.Rt.Android.csproj'), '-f', 'net10.0-android', '-c', 'Release'], artifacts: ['**/*-signed.aab'] };
  return { ...base, build: [], artifacts: [] };
}

function runBuild(plan, project) {
  if (!plan.build.length) return { status: 'no-build-required' };
  let command = plan.build[0];
  let args = plan.build.slice(1);
  if (command.startsWith('scripts/')) command = path.join(project, command);
  if (command === './gradlew') command = path.join(project, 'gradlew');
  const result = spawnSync(command, args, { cwd: project, stdio: 'inherit', env: process.env });
  if (result.error) throw new Error(`${plan.targetId}: could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${plan.targetId}: release build failed with exit ${result.status}.`);
  return { status: 'built', command: [command, ...args] };
}

export function validate(plan, project, explicitArtifact) {
  if (plan.targetId.startsWith('web-')) {
    const result = validateWebArtifacts(project, plan.targetId, plan.renderMode || 'static');
    if (explicitArtifact) {
      const requested = path.resolve(explicitArtifact);
      result.explicitArtifact = requested;
      result.explicitArtifactDeclared = result.artifacts.includes(requested);
      result.valid = result.valid && result.explicitArtifactDeclared;
    }
    return result;
  }
  if (explicitArtifact) return { valid: fs.existsSync(explicitArtifact), artifacts: fs.existsSync(explicitArtifact) ? [explicitArtifact] : [] };
  const predicates = plan.targetId.endsWith('android') || plan.targetId.startsWith('android-')
      ? (file) => /\.(aab|apk)$/.test(file)
      : plan.targetId.endsWith('ios') || plan.targetId.startsWith('ios-')
        ? (file) => /\.ipa$/.test(file) || file.includes('.xcarchive' + path.sep)
        : plan.targetId === 'rust-web'
          ? (file) => /\.wasm$/.test(file)
          : plan.targetId.endsWith('desktop')
            ? (file) => /\.(?:exe|AppImage|deb|rpm|dmg|pkg)$/.test(file) || /\.tar\.gz$/.test(file) || file.includes(`${path.sep}publish${path.sep}`) || file.includes('.app' + path.sep + 'Contents' + path.sep + 'MacOS')
            : () => false;
  const artifacts = find(project, predicates);
  return { valid: artifacts.length >= 1, artifacts };
}

export function webDeploymentInvocation(plan, opts) {
  if (!plan.targetId.startsWith('web-')) throw new Error(`${plan.targetId} is not an authored web lane.`);
  if (plan.renderMode === 'ssr') {
    throw new Error(
      `${plan.targetId} SSR deployment is not automated: deploy ${plan.artifacts[0]} and ${plan.clientOutputDir} to a compatible Node application host.`,
    );
  }
  const validation = validate(plan, opts.project, '');
  if (!validation.valid) {
    throw new Error(`${plan.targetId}: static deployment artifacts are missing: ${validation.missing.join(', ')}.`);
  }
  const staticRoot = validation.staticOutputDir;
  if (opts.provider === 'vercel') return { command: 'vercel', args: [staticRoot, '--prod'], cwd: opts.project, staticRoot };
  if (opts.provider === 'netlify') {
    return { command: 'netlify', args: ['deploy', '--prod', '--dir', staticRoot], cwd: opts.project, staticRoot };
  }
  throw new Error('Static web deployment requires --provider vercel or --provider netlify.');
}

function external(plan, opts) {
  if (plan.targetId.startsWith('web-')) {
    const invocation = webDeploymentInvocation(plan, opts);
    return spawnSync(invocation.command, invocation.args, { cwd: invocation.cwd, stdio: 'inherit' });
  }
  if (plan.targetId.startsWith('android-') || plan.targetId === 'rust-android' || plan.targetId === 'csharp-android') {
    if (opts.provider !== 'play') throw new Error(`${plan.targetId} upload requires --provider play.`);
    if (!opts.artifact) throw new Error(`${plan.targetId} upload requires --artifact <signed.aab>.`);
    return spawnSync('fastlane', ['supply', '--aab', opts.artifact], { cwd: opts.project, stdio: 'inherit' });
  }
  if (plan.targetId.startsWith('ios-') || plan.targetId === 'rust-ios' || plan.targetId === 'csharp-ios') {
    if (opts.provider !== 'app-store') throw new Error(`${plan.targetId} upload requires --provider app-store.`);
    if (!opts.artifact) throw new Error(`${plan.targetId} upload requires --artifact <signed.ipa>.`);
    return spawnSync('xcrun', ['altool', '--upload-app', '-f', opts.artifact, '-t', 'ios'], { cwd: opts.project, stdio: 'inherit' });
  }
  throw new Error(`${plan.targetId} upload is credential/provider specific; build and validate the artifact, then use the platform account tooling.`);
}

export function resolveReleaseRoots(opts) {
  const roots = new Map(opts.targets.map((target) => [target.id, opts.project]));
  const webTargets = opts.targets.filter((target) => target.platform === 'web');
  if (!webTargets.length) return roots;
  let records;
  try {
    records = discoverExportManifests(opts.project);
  } catch (error) {
    if (error instanceof ExportManifestError) throw new Error(error.message);
    throw error;
  }
  // `plan` remains useful before an export exists. Once any export manifest is present, or for
  // every state-changing/build/validation command, target identity must be manifest-backed.
  if (!records.length && opts.command === 'plan') return roots;
  let resolved;
  try {
    resolved = resolveManifestTargetRoots(opts.project, webTargets.map((target) => target.id));
  } catch (error) {
    if (error instanceof ExportManifestError) throw new Error(error.message);
    throw error;
  }
  for (const target of webTargets) roots.set(target.id, resolved.roots.get(target.id));
  return roots;
}

function main() {
try {
  const opts = parseArgs(process.argv.slice(2));
  const roots = resolveReleaseRoots(opts);
  const reports = [];
  for (const target of opts.targets) {
    const project = roots.get(target.id) || opts.project;
    if (target.platform === 'web' && fs.existsSync(path.join(project, 'nativeui-export-manifest.json'))) {
      readExportManifest(project, { targetId: target.id, renderMode: opts.renderMode });
    }
    const targetOpts = { ...opts, project };
    const plan = planFor(target, project, targetOpts);
    const report = { ...plan, projectRoot: project };
    if (opts.command === 'build') report.result = runBuild(plan, project);
    else if (opts.command === 'validate') {
      report.result = validate(plan, project, opts.artifact);
      if (!report.result.valid) throw new Error(`${target.id}: expected release artifacts were not found.`);
    } else if (opts.command === 'upload' || opts.command === 'deploy') {
      const result = external(plan, targetOpts);
      if (result.error || result.status !== 0) throw new Error(`${target.id}: external ${opts.command} failed.`);
      report.result = { status: opts.command };
    }
    reports.push(report);
  }
  if (opts.format === 'json') process.stdout.write(JSON.stringify({ command: opts.command, reports }, null, 2) + '\n');
  else for (const report of reports) process.stdout.write(`${report.targetId}: build=${report.build.join(' ')} artifacts=${report.artifacts.join(', ')}${report.result ? ` result=${JSON.stringify(report.result)}` : ''}\n`);
} catch (error) {
  process.stderr.write(`${error.message || error}\n`);
  process.exit(1);
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
