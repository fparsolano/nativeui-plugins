#!/usr/bin/env node
// Build the repo-local Codex plugin marketplace artifact for NativeUI.
//
// Output layout:
//   .agents/plugins/marketplace.json
//   plugins/nativeui/.codex-plugin/plugin.json
//   plugins/nativeui/skills/
//   plugins/nativeui/bin/
//   plugins/nativeui/admin/

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_PLUGIN_SRC = path.join(REPO_ROOT, 'nativeui-plugin');

const PLUGIN_NAME = 'nativeui';
const VERSION = '0.2.0+codex.20260720202430';
const DESCRIPTION =
  'Create responsive, parent-constrained NativeUI apps with complete dynamic flows across native, desktop, and five authored web lanes.';

function parseArgs(argv) {
  let outRoot = REPO_ROOT;
  let pluginSrc = DEFAULT_PLUGIN_SRC;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') {
      outRoot = path.resolve(argv[++i] || '');
      if (!outRoot) throw new Error('--out requires a path.');
    } else if (a === '--plugin-src') {
      pluginSrc = path.resolve(argv[++i] || '');
      if (!pluginSrc) throw new Error('--plugin-src requires a path.');
    } else if (a === '-h' || a === '--help') {
      throw new Error('Usage: node nativeui-codex/build-codex-plugin.mjs [--out <repo-root>] [--plugin-src <nativeui-plugin>]');
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return { outRoot, pluginSrc };
}

async function assertDir(dir, label) {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`${label} not found: ${dir}`);
}

async function copyDir(src, dest) {
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(src, dest, {
    recursive: true,
    filter: (source) =>
      !source.includes(`${path.sep}node_modules${path.sep}`) && path.basename(source) !== '.DS_Store',
  });
}

async function walkFiles(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function codexPathNote(skillName) {
  return (
    `\n> Codex plugin path note: resolve \`<bin>\` as the NativeUI plugin's ` +
    `\`bin/\` directory and \`<this-skill>\` as ` +
    `\`skills/${skillName}\` inside the installed plugin source before running commands.\n\n`
  );
}

function rewriteSkillMarkdown(text) {
  return text
    .replaceAll('${CLAUDE_SKILL_DIR}/../../bin', '<bin>')
    .replaceAll('node */nativeui-plugin/bin/*', 'node <bin>/*')
    .replaceAll('${CLAUDE_SKILL_DIR}', '<this-skill>');
}

async function rewriteCodexSkillFiles(skillsDir) {
  const files = await walkFiles(skillsDir);
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    let text = await fs.readFile(file, 'utf8');
    text = rewriteSkillMarkdown(text);
    if (path.basename(file) === 'SKILL.md') {
      const skillName = path.basename(path.dirname(file));
      const frontmatterEnd = text.indexOf('\n---', 4);
      if (frontmatterEnd !== -1 && !text.includes('Codex plugin path note:')) {
        const insertAt = frontmatterEnd + '\n---'.length;
        text = `${text.slice(0, insertAt)}${codexPathNote(skillName)}${text.slice(insertAt)}`;
      }
    }
    await fs.writeFile(file, text);
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
}

async function build({ outRoot, pluginSrc }) {
  const skillsSrc = path.join(pluginSrc, 'skills');
  const binSrc = path.join(pluginSrc, 'bin');
  const adminSrc = path.join(pluginSrc, 'admin');
  const capabilitiesSrc = path.join(pluginSrc, 'capabilities');
  await assertDir(skillsSrc, 'skills source');
  await assertDir(binSrc, 'bin source');
  await assertDir(adminSrc, 'admin source');
  await assertDir(capabilitiesSrc, 'capabilities source');

  const pluginOut = path.join(outRoot, 'plugins', PLUGIN_NAME);
  await fs.rm(pluginOut, { recursive: true, force: true });
  await fs.mkdir(pluginOut, { recursive: true });

  await copyDir(skillsSrc, path.join(pluginOut, 'skills'));
  await copyDir(binSrc, path.join(pluginOut, 'bin'));
  await copyDir(adminSrc, path.join(pluginOut, 'admin'));
  await copyDir(capabilitiesSrc, path.join(pluginOut, 'capabilities'));
  const assetsOut = path.join(pluginOut, 'assets');
  await fs.mkdir(assetsOut, { recursive: true });
  await fs.copyFile(
    path.join(REPO_ROOT, 'nativeui.com', 'public', 'android-chrome-512x512.png'),
    path.join(assetsOut, 'nativeui-icon.png'),
  );
  await fs.copyFile(
    path.join(REPO_ROOT, 'nativeui.com', 'public', 'assets', 'logo', 'NativeUI-Dark.svg'),
    path.join(assetsOut, 'nativeui-logo.svg'),
  );
  await fs.copyFile(
    path.join(REPO_ROOT, 'nativeui.com', 'public', 'assets', 'logo', 'NativeUI-Light.svg'),
    path.join(assetsOut, 'nativeui-logo-dark.svg'),
  );
  await rewriteCodexSkillFiles(path.join(pluginOut, 'skills'));

  await writeJson(path.join(pluginOut, '.codex-plugin', 'plugin.json'), {
    name: PLUGIN_NAME,
    version: VERSION,
    description: DESCRIPTION,
    author: { name: 'NativeUI' },
    skills: './skills/',
    homepage: 'https://nativeui.com/',
    keywords: ['nativeui', 'ios', 'android', 'rust', 'csharp', 'desktop', 'web', 'html', 'react', 'vue', 'angular', 'astro', 'pwa', 'codegen'],
    interface: {
      displayName: 'NativeUI',
      shortDescription: 'AI-assisted UI-to-app workflows for every NativeUI target.',
      longDescription:
        'NativeUI helps Codex choose mobile, web, or desktop delivery, create responsive parent-constrained UI with complete dynamic flows, round-trip screens through the editor, connect durable logic, and release SwiftUI, Compose, Rust, C#, or authored HTML, React, Vue, Angular, and Astro PWAs. Hosted import and export require NativeUI access.',
      developerName: 'NativeUI',
      category: 'App Development',
      capabilities: ['Write', 'Interactive'],
      defaultPrompt: [
        'Create a responsive, dynamic mobile app. Use flagship SwiftUI plus Compose by default and explain the Rust and C# alternatives.',
        'Create a responsive, dynamic web PWA. Choose HTML, React, Vue, Angular, or Astro and static or SSR; default to HTML static.',
        'Create a responsive desktop app. Default to Rust; explain C# and that macOS SwiftUI is unavailable without a new exporter.',
      ],
      brandColor: '#111827',
      websiteURL: 'https://nativeui.com/',
      composerIcon: './assets/nativeui-icon.png',
      logo: './assets/nativeui-logo.svg',
      logoDark: './assets/nativeui-logo-dark.svg',
    },
  });

  await writeJson(path.join(outRoot, '.agents', 'plugins', 'marketplace.json'), {
    name: 'nativeui-marketplace',
    interface: { displayName: 'NativeUI' },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: {
          source: 'local',
          path: './plugins/nativeui',
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_INSTALL',
        },
        category: 'App Development',
      },
    ],
  });

  return {
    marketplace: path.join(outRoot, '.agents', 'plugins', 'marketplace.json'),
    plugin: pluginOut,
  };
}

async function main() {
  try {
    const result = await build(parseArgs(process.argv.slice(2)));
    process.stdout.write(`Built Codex marketplace: ${result.marketplace}\n`);
    process.stdout.write(`Built Codex plugin: ${result.plugin}\n`);
  } catch (err) {
    process.stderr.write(`${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}

export { build, rewriteSkillMarkdown };
