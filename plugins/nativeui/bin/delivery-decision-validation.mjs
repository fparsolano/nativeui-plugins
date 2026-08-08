// Shared fail-closed checks for the delivery decisions recorded by the design
// and architecture agents. The checks intentionally accept either the current
// scaffold fields or equivalent authored prose so older, completed records do
// not have to be rewritten just to satisfy a newer template.

import { loadTargetContract } from './target-contract.mjs';

const PLACEHOLDER_RE = /(?:^|\b)(?:tbd|todo|undecided|unresolved|not supplied|not decided|to be (?:decided|confirmed|determined)|pending (?:decision|confirmation)|ask (?:the )?user|confirm (?:with )?(?:the )?user)(?:\b|$)/i;
const INSTRUCTION_RE = /(?:^|\b)(?:choose|select|record|define|describe|name|add a row|list any|summarize|document which|confirm)\b/i;
const CHOICE_RE = /\b(?:or|one of|whichever|as applicable|if applicable)\b/i;

function normalize(value) {
  return String(value || '')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function markdownSection(text, heading) {
  const source = String(text || '');
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^##\\s+${escaped}\\s*$`, 'mi').exec(source);
  if (!match) return '';
  const start = match.index + match[0].length;
  const remainder = source.slice(start);
  const next = /^##\s+/m.exec(remainder);
  return (next ? remainder.slice(0, next.index) : remainder).trim();
}

function fields(section) {
  const out = [];
  for (const rawLine of String(section || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = /^[-*]\s+(.+?):\s*(.*)$/.exec(line);
    if (!match) continue;
    out.push({ label: normalize(match[1]), value: normalize(match[2]), raw: line });
  }
  return out;
}

function findField(section, labelPattern) {
  return fields(section).find((field) => labelPattern.test(field.label)) || null;
}

export function isUnansweredDecision(value, { allowNone = false } = {}) {
  const text = normalize(value);
  if (!text) return true;
  if (allowNone && /^(?:none|no|n\/a|not applicable)(?:[.;]|$)/i.test(text)) return false;
  if (/^(?:none|n\/a|not applicable|[-?]|\.{3})$/i.test(text)) return true;
  if (PLACEHOLDER_RE.test(text)) return true;
  if (/^(?:mobile,? web,? desktop|html,? react,? vue,? angular,? (?:or )?astro)/i.test(text)) return true;
  return false;
}

function targetMetadata() {
  const contract = loadTargetContract();
  return new Map(contract.targets.map((target) => [target.id, target]));
}

function selectedTargetIdsFrom(value) {
  const metadata = targetMetadata();
  const text = normalize(value).toLowerCase();
  return [...metadata.keys()].filter((id) => new RegExp(`(?:^|[^a-z0-9-])${id.replaceAll('-', '\\-')}(?:$|[^a-z0-9-])`, 'i').test(text));
}

function legacyTargetIds(section) {
  const candidates = String(section || '').split(/\r?\n/).filter((raw) => {
    const line = normalize(raw);
    if (!line || /\b(?:default|offer|alternative|choice|available|unavailable|inferred surface|fallback)\b/i.test(line)) return false;
    return /\b(?:select(?:ed)?|deliver(?:y)?|target|export|build|ship|using)\b/i.test(line);
  });
  const exact = selectedTargetIdsFrom(candidates.join('\n'));
  if (exact.length) return exact;

  // Older authored records occasionally used framework names instead of the
  // canonical IDs. Accept those only on lines that clearly state a selection,
  // never from the scaffold's list of offered alternatives.
  const joined = candidates.join(' ').toLowerCase();
  const aliases = [
    [/\bswiftui\b/, 'ios-swiftui'],
    [/\buikit\b/, 'ios-uikit'],
    [/\bcompose\b/, 'android-compose'],
    [/\bandroid views?\b/, 'android-views'],
    [/\b(?:vanilla|plain) html\b/, 'web-html'],
    [/\breact(?: router)?\b/, 'web-react'],
    [/\b(?:nuxt|vue)\b/, 'web-vue'],
    [/\bangular\b/, 'web-angular'],
    [/\bastro\b/, 'web-astro'],
    [/\brust desktop\b/, 'rust-desktop'],
    [/\bc# desktop\b|\bcsharp desktop\b|\.net desktop\b/, 'csharp-desktop'],
  ];
  return aliases.filter(([pattern]) => pattern.test(joined)).map(([, id]) => id);
}

function surfacesFor(targetIds) {
  const metadata = targetMetadata();
  return new Set(targetIds.map((id) => {
    const target = metadata.get(id);
    if (!target) return '';
    if (target.platform === 'ios' || target.platform === 'android' || /-(?:ios|android)$/.test(id)) return 'mobile';
    if (id.startsWith('web-') || id === 'rust-web') return 'web';
    if (id.endsWith('-desktop')) return 'desktop';
    return target.platform;
  }).filter(Boolean));
}

function concreteSelectionEvidence(section, patterns) {
  return String(section || '').split(/\r?\n/).map(normalize).find((line) => {
    if (!line || isUnansweredDecision(line) || INSTRUCTION_RE.test(line)) return false;
    return patterns.every((pattern) => pattern.test(line));
  }) || '';
}

function analyzeDeliverySection(section, { sectionName }) {
  const errors = [];
  const targetField = findField(section, /^(?:selected\s+)?target ids?$/i);
  let targetIds = [];
  if (targetField) {
    if (isUnansweredDecision(targetField.value)) {
      errors.push(`${sectionName}: Selected target IDs is unanswered.`);
    } else {
      targetIds = selectedTargetIdsFrom(targetField.value);
      if (!targetIds.length) errors.push(`${sectionName}: Selected target IDs must name at least one registered target ID.`);
    }
  } else {
    targetIds = legacyTargetIds(section);
    if (!targetIds.length) errors.push(`${sectionName}: no concrete selected target is recorded.`);
  }

  const surfaces = surfacesFor(targetIds);
  let renderMode = '';
  if (surfaces.has('web')) {
    const renderField = findField(section, /web.*render mode|web lane and render mode/i);
    const renderValue = renderField?.value || concreteSelectionEvidence(section, [/\b(?:static|ssr)\b/i, /\b(?:web|html|react|vue|nuxt|angular|astro)\b/i]);
    if (renderField && isUnansweredDecision(renderField.value)) {
      errors.push(`${sectionName}: the selected web lane needs a concrete static or SSR render mode.`);
    } else if (!renderValue && targetIds.every((id) => id === 'web-html')) {
      renderMode = 'static';
    } else if (!renderValue || /\bstatic\s*(?:\/|or)\s*ssr\b|\bssr\s*(?:\/|or)\s*static\b/i.test(renderValue)) {
      errors.push(`${sectionName}: the selected web lane needs a concrete static or SSR render mode.`);
    } else if (/\bssr\b/i.test(renderValue)) {
      renderMode = 'ssr';
    } else if (/\bstatic\b/i.test(renderValue)) {
      renderMode = 'static';
    } else {
      errors.push(`${sectionName}: the selected web lane needs a concrete static or SSR render mode.`);
    }
    if (renderMode === 'ssr' && targetIds.includes('web-html')) {
      errors.push(`${sectionName}: web-html supports static rendering only.`);
    }
  }
  return { errors, targetIds: [...new Set(targetIds)], surfaces, renderMode };
}

function unresolvedCriticalQuestion(text) {
  const critical = /\b(?:target|lane|render mode|static|ssr|host(?:ing)?|runtime|viewport|parent constraint|scroll owner|reflow|breakpoint)\b/i;
  return String(text || '').split(/\r?\n/).map(normalize).find((line) => {
    if (!critical.test(line)) return false;
    return /\?$/.test(line) || PLACEHOLDER_RE.test(line) || /\b(?:need to|must still|awaiting|confirm|choose|decide)\b/i.test(line);
  }) || '';
}

function hasConcreteParentConstraint(section) {
  const lines = String(section || '').split(/\r?\n/).map(normalize).filter((line) => {
    if (!line || /^\|?\s*:?-{3}/.test(line)) return false;
    if (/\b(?:region\/component|owning parent|width ownership)\b/i.test(line)) return false;
    if (PLACEHOLDER_RE.test(line) || INSTRUCTION_RE.test(line)) return false;
    return true;
  });
  const evidence = lines.join(' ');
  const ownsSpace = /\b(?:parent|viewport|window|shell|container|pane)\b/i.test(evidence);
  const sizing = /\b(?:fill|grow|shrink|min(?:imum)?|max(?:imum)?|intrinsic|content-sized|available width|available height)\b/i.test(evidence);
  const scroll = /\b(?:scroll|overflow)\b/i.test(evidence);
  const reflow = /\b(?:reflow|stack|split|grid|wrap|breakpoint|compact|expanded|remains)\b/i.test(evidence);
  return ownsSpace && sizing && scroll && reflow;
}

export function validateDesignGuideDecisions(text) {
  const delivery = markdownSection(text, 'Delivery Targets');
  const constraints = markdownSection(text, 'Parent Constraint Matrix');
  const questions = markdownSection(text, 'Open Questions');
  const result = analyzeDeliverySection(delivery, { sectionName: 'Delivery Targets' });
  const errors = [...result.errors];
  if (!hasConcreteParentConstraint(constraints)) {
    errors.push('Parent Constraint Matrix: add at least one concrete region with parent ownership, sizing, scroll ownership, and reflow behavior.');
  }
  const unresolved = unresolvedCriticalQuestion(questions);
  if (unresolved) errors.push(`Open Questions: a delivery or responsive decision is still unresolved (${unresolved}).`);
  return { ...result, errors };
}

function requireConcreteField(section, labelPattern, description, { fallbackPatterns = [], allowNone = false } = {}) {
  const field = findField(section, labelPattern);
  if (field) {
    if (!isUnansweredDecision(field.value, { allowNone }) && !CHOICE_RE.test(field.value)) return '';
    return `${description} is unanswered.`;
  }
  if (fallbackPatterns.length && concreteSelectionEvidence(section, fallbackPatterns)) return '';
  return `${description} is not recorded.`;
}

export function validateArchitectureDecisions(text) {
  const selected = markdownSection(text, 'Selected Delivery Targets');
  const result = analyzeDeliverySection(selected, { sectionName: 'Selected Delivery Targets' });
  const errors = [...result.errors];

  // This field was added to the current scaffold. Keep older completed records
  // valid when they predate it, but never let a newly scaffolded blank field
  // masquerade as a resolved responsive architecture decision.
  const constraintField = findField(selected, /^responsive parent-constraint/i);
  if (constraintField) {
    const value = constraintField.value;
    const concrete = !isUnansweredDecision(value)
      && /\b(?:parent|viewport|window|shell|container|pane)\b/i.test(value)
      && /\b(?:scroll(?:s|ed|ing)?|overflow(?:s|ed|ing)?)\b/i.test(value)
      && /\b(?:reflow(?:s|ed|ing)?|stack(?:s|ed|ing)?|split(?:s|ting)?|grid|wrap(?:s|ped|ping)?|breakpoint|compact|expanded)\b/i.test(value);
    if (!concrete) {
      errors.push('Responsive parent-constraint, scroll-owner, and structural reflow implications are unanswered.');
    }
  }

  errors.push(requireConcreteField(markdownSection(text, 'Recommended Stack'), /^stack$/i, 'Recommended Stack'));
  errors.push(requireConcreteField(markdownSection(text, 'Local Run Plan'), /^command$/i, 'Local Run Plan command'));
  errors.push(requireConcreteField(markdownSection(text, 'Deployment Plan'), /^target$/i, 'Deployment target'));
  errors.push(requireConcreteField(markdownSection(text, 'Repository Layout'), /^backend path$/i, 'Backend repository path'));
  errors.push(requireConcreteField(markdownSection(text, 'API Database Auth Contract'), /^routes?$/i, 'API route contract', {
    fallbackPatterns: [/\b(?:route|endpoint|no server routes?)\b/i],
  }));

  const client = markdownSection(text, 'Client Delivery And Hosting');
  errors.push(requireConcreteField(client, /^api origin(?:,|$)/i, 'API origin'));
  errors.push(requireConcreteField(client, /^authentication\/session model/i, 'Authentication/session model', {
    fallbackPatterns: [/\b(?:auth|session|bearer|cookie|no authentication)\b/i],
  }));

  if (result.surfaces.has('web')) {
    errors.push(requireConcreteField(selected, /^web lane(?:\s|$)/i, 'Web lane', {
      fallbackPatterns: [/\bweb-(?:html|react|vue|angular|astro)\b/i],
    }));
    errors.push(requireConcreteField(client, /^web host mode$/i, 'Web hosting/runtime mode', {
      fallbackPatterns: [/\b(?:static (?:assets?|hosting|cdn)|node (?:ssr|runtime)|server-rendered)\b/i],
    }));
    errors.push(requireConcreteField(client, /^client routes and direct-load behavior$/i, 'Web direct-route behavior'));
    errors.push(requireConcreteField(client, /^base path and trailing-slash policy$/i, 'Web base-path policy'));
  }

  if (result.surfaces.has('desktop')) {
    errors.push(requireConcreteField(selected, /^desktop operating systems and cpu architectures$/i, 'Desktop OS/CPU scope'));
  }

  return { ...result, errors: errors.filter(Boolean) };
}
