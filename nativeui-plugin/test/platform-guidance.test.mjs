import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_DIR } from './helpers.mjs';

const read = (relative) => fs.readFileSync(path.join(PLUGIN_DIR, relative), 'utf8');

test('shared delivery brief documents contextual defaults and honest alternatives', () => {
  const guidance = read('skills/nativeui/references/delivery-targets.md');
  for (const term of ['mobile-flagship', 'mobile-rust', 'mobile-csharp', 'web-html', 'web-react',
    'web-vue', 'web-angular', 'web-astro', 'static', 'SSR', 'rust-desktop', 'csharp-desktop']) {
    assert.ok(guidance.includes(term), `delivery brief must mention ${term}`);
  }
  assert.match(guidance, /For every desktop request, present all three choices/i);
  assert.match(guidance, /macOS SwiftUI.*requires a separately scoped\/new `macos-swiftui` exporter/is);
  assert.match(guidance, /Never\s+simulate responsiveness by scaling or centering a fixed canvas/i);
  assert.match(guidance, /parent that owns its width and height/i);
  assert.match(guidance, /`Static` describes the build and hosting mode, not a static mockup, fixed viewport, or reduced capability set/i);
  assert.match(guidance, /Ask only what is unresolved/i);
});

test('the shared brief asks the complete phase-specific questions without repeating answered choices', () => {
  const guidance = read('skills/nativeui/references/delivery-targets.md');
  for (const heading of [
    'Walkthrough and intake',
    'Design',
    'Architecture',
    'Deployment and release',
  ]) {
    assert.match(guidance, new RegExp(`^### ${heading}$`, 'm'), `missing ${heading} question phase`);
  }
  for (const term of [
    'audience', 'primary job or journey', 'OS/browser ranges', 'static or SSR',
    'screens, branches, and completion/retry paths', 'parent owns sizing, scrolling, and pinned edges',
    'API, database, auth/session', 'frontend and backend live in the repository',
    'provider/runtime, region, domain/base path', 'health check', 'observability', 'rollback strategy',
    'route fallback/base path', 'service-worker update policy', 'signing accounts',
    'signing/notarization', 'credentials and external-state approval',
  ]) {
    assert.ok(guidance.toLowerCase().includes(term.toLowerCase()), `delivery questions must include ${term}`);
  }
  assert.match(guidance, /Carry resolved answers forward between intake, design, architecture, and release/i);
  assert.match(guidance, /must not ask the same brief again/i);
});

test('walkthrough, design, architecture, and release share the same decision contract', () => {
  const files = [
    'skills/nativeui/SKILL.md',
    'skills/nativeui-app/SKILL.md',
    'skills/nativeui-design/SKILL.md',
    'skills/nativeui-architect/SKILL.md',
    'skills/nativeui-release/SKILL.md',
  ];
  for (const file of files) {
    assert.match(read(file), /delivery-targets\.md|delivery brief/i, `${file} must use the delivery brief`);
  }
  for (const file of ['skills/nativeui/SKILL.md', 'skills/nativeui-app/SKILL.md']) {
    assert.match(read(file), /macOS SwiftUI/i, `${file} must present the Apple-native desktop choice`);
    assert.match(read(file), /separately scoped\/new[\s\S]*`macos-swiftui`[\s\S]*exporter/i,
      `${file} must describe the missing exporter honestly`);
    assert.match(read(file), /never (?:map|substitute)[\s\S]*(?:iOS SwiftUI|ios-swiftui)/i,
      `${file} must not route the iOS lane to desktop`);
  }
  assert.match(read('skills/nativeui-architect/SKILL.md'), /CORS/);
  assert.match(read('skills/nativeui-architect/SKILL.md'), /cookie\/session/);
  assert.match(read('skills/nativeui-release/SKILL.md'), /static\/SSR/);
  assert.match(read('skills/nativeui-release/SKILL.md'), /signing\/notarization/);
});

test('authored web guidance bans runtime model shells and names every developer seam', () => {
  const guidance = read('skills/nativeui/references/delivery-targets.md');
  const contract = read('skills/nativeui/references/backend-contract.md');
  const review = read('skills/nativeui-review/SKILL.md');
  for (const source of [guidance, contract]) {
    assert.match(source, /app-actions/);
    assert.match(source, /data-adapters/);
    assert.match(source, /custom-components/);
  }
  assert.match(guidance, /do not ship iframes/i);
  assert.match(guidance, /runtime model interpreters/i);
  assert.match(contract, /compiled directly/);
  assert.match(contract, /\.new/);
  for (const source of [guidance, review]) {
    assert.match(source, /every manifest-declared capability occurrence|every declared capability occurrence/i);
    assert.match(source, /node kind, action, trigger, and timeline property/i);
    assert.match(source, /exact implementation\s+receipt/i);
  }
  assert.match(guidance, /missing receipt.*export\/review error/is);
  assert.match(review, /fail closed.*missing receipt/is);
  assert.match(review, /reference-lane parity.*not implementation\s+evidence/is);
});

test('canonical guidance never promotes a preview snapshot or stock breakpoint to product geometry', () => {
  const projectModel = read('skills/nativeui/references/project-model.md');
  const authoringRules = read('skills/nativeui/references/authoring-rules.md');
  const examples = read('skills/nativeui/examples/README.md');
  const cliReference = read('bin/README.md');
  const targets = JSON.parse(read('capabilities/nativeui-targets.json'));

  assert.doesNotMatch(projectModel, /Absent\/empty\s*=\s*non-responsive/i);
  assert.match(projectModel, /intrinsically responsive/i);
  assert.match(projectModel, /does not authorize (?:captured\/)?resolved px/i);
  assert.doesNotMatch(projectModel, /"stage(?:Width|Height)"\s*:\s*\d/i);
  assert.match(projectModel, /stageWidth\/stageHeight are intentionally omitted/i);

  assert.match(authoringRules, /intentional intrinsic component/i);
  assert.doesNotMatch(authoringRules, /top:\s*132px|bottom:\s*76px|height:\s*132px/i);
  assert.match(authoringRules, /Keep top bars, bottom bars, and ordinary chrome in the parent-owned flex\/grid shell by default/i);
  assert.doesNotMatch(authoringRules, /position:fixed[^\n]*(?:use for|top bars|bottom tab bars)/i);
  assert.match(examples, /auto-fit.*minmax/i);
  assert.doesNotMatch(examples, /responsive\s+`?@media/i);
  assert.doesNotMatch(examples, /pinned `position:absolute` top bar/i);

  const exampleDir = path.join(PLUGIN_DIR, 'skills/nativeui/examples');
  for (const name of fs.readdirSync(exampleDir).filter((file) => file.endsWith('.html'))) {
    const source = fs.readFileSync(path.join(exampleDir, name), 'utf8');
    assert.doesNotMatch(source, /^\s*body\s*\{[^}]*\b(?:width|height)\s*:\s*\d+(?:\.\d+)?px/ims,
      `${name} must not seed a fixed body canvas`);
  }

  for (const lane of ['web-html', 'web-react', 'web-vue', 'web-angular', 'web-astro']) {
    assert.ok(cliReference.includes(lane), `CLI reference must include ${lane}`);
  }
  assert.match(targets.deliveryProfiles.mobile.decisionQuestions.join(' '), /bare mobile request means both/i);
  const desktop = targets.deliveryProfiles.desktop;
  assert.equal(desktop.defaultSelection.targetIds[0], 'rust-desktop');
  assert.equal(desktop.unavailableChoices[0].presentByDefault, true);
  assert.match(desktop.unavailableChoices[0].description, /Apple-native macOS desktop alternative/i);
  assert.match(desktop.decisionQuestions.join(' '), /all three choices.*default Rust lane.*available C# lane.*macOS-only SwiftUI exporter/i);
});

test('static render mode is never confused with inert behavior or a responsive-audit opt-out', () => {
  const workflowFiles = [
    'skills/nativeui/SKILL.md',
    'skills/nativeui-app/SKILL.md',
    'skills/nativeui-design/SKILL.md',
    'skills/nativeui-update/SKILL.md',
    'skills/nativeui-intake/SKILL.md',
    'skills/nativeui-developer/SKILL.md',
    'capabilities/nativeui-agent-capabilities.json',
  ];
  for (const file of workflowFiles) {
    const source = read(file);
    assert.doesNotMatch(source, /plain[-/]static|static\/non-responsive|responsive static mockup|dead static mockup|static one-size/i, file);
  }

  const run = read('skills/nativeui-run/SKILL.md');
  const release = read('skills/nativeui-release/SKILL.md');
  const architect = read('skills/nativeui-architect/SKILL.md');
  const deployment = read('skills/nativeui-backend/references/backend-deployment.md');
  const scaffold = read('bin/nui-architecture.mjs');
  for (const [name, source] of Object.entries({ run, release, architect, deployment, scaffold })) {
    assert.match(source, /static[\s\S]{0,240}(?:build|hosting|delivery mode)/i,
      `${name} must explain static as build/hosting, not behavior`);
    assert.match(source, /static[\s\S]{0,420}(?:responsive|interaction|dynamic|capabilit)/i,
      `${name} must preserve responsive/dynamic behavior in static mode`);
  }

  const targets = JSON.parse(read('capabilities/nativeui-targets.json'));
  const htmlChoice = targets.deliveryProfiles.web.choices.find((choice) => choice.id === 'html');
  const htmlTarget = targets.targets.find((target) => target.id === 'web-html');
  assert.match(htmlChoice.tradeoffs, /Static build\/hosting only but fully client-interactive/i);
  assert.match(htmlTarget.tradeoffs, /Static build\/hosting only but fully client-interactive/i);
  assert.match(targets.deliveryProfiles.web.decisionQuestions.join(' '), /neither choice reduces responsive or dynamic behavior/i);
});

test('flow-audit failures are project readiness blockers, not web-lane capability gaps', () => {
  const developer = read('skills/nativeui-developer/SKILL.md');
  const app = read('skills/nativeui-app/SKILL.md');
  const update = read('skills/nativeui-update/SKILL.md');
  const general = read('skills/nativeui/SKILL.md');
  for (const source of [developer, app, update, general]) {
    assert.match(source, /project-readiness blocker/i);
    assert.match(source, /lane supports it|selected lane supports it/i);
  }
  assert.match(developer, /Never phrase[\s\S]*Vue export needs/i);
  assert.match(general, /Never phrase[\s\S]*Vue export needs/i);
});

test('positive web review fixtures use intrinsic flow instead of preset device buckets', () => {
  const review = read('test/final-review.test.mjs');
  const flow = read('test/flow-audit.test.mjs');
  assert.match(review, /repeat\(auto-fit,minmax\(min\(100%,18rem\),1fr\)\)/);
  assert.doesNotMatch(review, /@media\s*\(\s*min-width\s*:\s*(?:600|768|1024)px/i);
  assert.doesNotMatch(review, /stageWidth\s*:\s*412|stageHeight\s*:\s*915/i);
  assert.match(flow, /interaction-free HTML fails the dynamic-flow gate/i);
  assert.doesNotMatch(flow, /@media\s*\(\s*min-width\s*:\s*768px/i);

  for (const file of [
    'skills/nativeui/references/authoring-rules.md',
    'skills/nativeui/examples/svg-icons-shapes.html',
    'skills/nativeui/examples/effects-clip-transforms.html',
    'skills/nativeui/examples/borders.html',
    'skills/nativeui/examples/forms.html',
    'skills/nativeui/examples/responsive-animated-home.html',
    'skills/nativeui/examples/finance-dashboard.html',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source,
      /repeat\(\s*auto-(?:fit|fill)\s*,\s*minmax\(\s*(?:\d|\.\d)/i,
      `${file} must cap auto-repeat track floors to the actual parent`);
    assert.match(source, /minmax\(min\(100%,\s*[^)]+\),\s*1fr\)/i,
      `${file} must demonstrate a parent-bounded auto-repeat track`);
  }
});

test('target knowledge carries complete mobile, web, and desktop choice descriptions', () => {
  const targets = JSON.parse(read('capabilities/nativeui-targets.json'));
  const mobile = targets.deliveryProfiles.mobile;
  assert.deepEqual(mobile.defaultSelection.targetIds, ['ios-swiftui', 'android-compose']);
  assert.deepEqual(mobile.choices.map((choice) => choice.id), ['flagship', 'rust', 'csharp']);
  for (const choice of mobile.choices) {
    assert.ok(choice.description && choice.bestFor && choice.tradeoffs, `mobile ${choice.id} needs full guidance`);
  }

  const web = targets.deliveryProfiles.web;
  assert.equal(web.defaultSelection.targetIds[0], 'web-html');
  assert.equal(web.defaultSelection.renderMode, 'static');
  assert.deepEqual(web.choices.map((choice) => choice.id), ['html', 'react', 'vue', 'angular', 'astro']);
  assert.deepEqual(web.choices[0].renderModes, ['static']);
  for (const choice of web.choices.slice(1)) {
    assert.deepEqual(choice.renderModes, ['static', 'ssr']);
    assert.ok(choice.description && choice.bestFor && choice.tradeoffs, `web ${choice.id} needs full guidance`);
  }

  const desktop = targets.deliveryProfiles.desktop;
  assert.equal(desktop.defaultSelection.targetIds[0], 'rust-desktop');
  assert.deepEqual(desktop.choices.map((choice) => choice.id), ['rust', 'csharp']);
  assert.equal(desktop.unavailableChoices[0].id, 'swiftui-macos');
  for (const choice of [...desktop.choices, ...desktop.unavailableChoices]) {
    assert.ok(choice.description && choice.bestFor && choice.tradeoffs,
      `desktop ${choice.id} needs full guidance`);
  }
});

test('portable authored behavior is not erased by a blanket data attribute ban', () => {
  for (const file of [
    'skills/nativeui/SKILL.md',
    'skills/nativeui-app/SKILL.md',
    'skills/nativeui-import/SKILL.md',
    'skills/nativeui-update/SKILL.md',
  ]) {
    const guidance = read(file);
    assert.match(guidance, /reserved portable\s+`data-nui-\*`/i, file);
    assert.doesNotMatch(guidance, /(?:NO|no) `data-\*`(?: attributes)?[.;)]/i, file);
  }
  assert.match(read('skills/nativeui/references/authoring-rules.md'), /data-nui-on-tap/);
});

test('accessibility guidance reflects the portable typed manifest contract', () => {
  const backend = read('skills/nativeui/references/backend-contract.md');
  const model = read('skills/nativeui/references/project-model.md');
  for (const source of [backend, model]) {
    assert.match(source, /aria-label/i);
    assert.match(source, /portable `role`|portable role/i);
    assert.doesNotMatch(source, /`aria-\*`[^\n]*NOT imported/i);
  }
  assert.match(backend, /every selected lane receives them/i);
  assert.match(model, /manifest-declared seams only for runtime-derived labels/i);
});

test('architecture and deployment guidance follows every selected manifest target', () => {
  const architect = read('skills/nativeui-architect/SKILL.md');
  const scaffold = read('bin/nui-architecture.mjs');
  const deployment = read('skills/nativeui-backend/references/backend-deployment.md');
  const dogfood = read('DOGFOOD.md');

  assert.match(architect, /every selected target's manifest-declared durable seams/i);
  assert.doesNotMatch(architect, /wire both native targets/i);
  assert.match(scaffold, /Selected target IDs and manifest-declared durable seams/);
  assert.match(scaffold, /Web app-actions\/data-adapters\/custom-components/);
  assert.match(deployment, /Rust, C#, and web use their declared action\/data seams/);
  assert.match(dogfood, /Apple-native macOS SwiftUI alternative/);
  assert.doesNotMatch(dogfood, /one `@media` \|/);
});
