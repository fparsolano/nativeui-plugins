// nui-validate.mjs — validate a project.json BEFORE export.
//
// Two layers, both FAIL CLOSED with clear messages:
//
//   1. STRUCTURAL (always, pure Node, no token): the JSON is well-formed; has an
//      integer `version`; non-empty `stages[]`; each stage has a non-empty
//      `rootNodes[]`; every node has a `kind` from the known JavaFX set and a
//      letter-first `id` (when present); no obvious type slips (numbers where
//      numbers belong, arrays where arrays belong). This catches the mistakes a
//      hand-edit makes — it does NOT prove the model accepts every nested field.
//
//   2. MODEL ROUND-TRIP (default, when configured + logged in): POST the project
//      to the export service's `/export/<platform>/manifest` endpoint, which
//      deserializes the body into the REAL ProjectState and re-serializes a file
//      manifest. If the service accepts it (HTTP 200 + a manifest), the model
//      round-trips authoritatively. A 400 means the exporter rejected the JSON —
//      that's a real validation failure. This is the authoritative check; the
//      manifest endpoint is reused because it round-trips the model without
//      building a full ZIP.
//
// Pass --structural to skip the service call (structural-only). Without auth/config
// the script still runs the structural check and notes the model check was skipped.
//
// Usage:
//   node bin/nui-validate.mjs <project.json> [--structural] [--platform android|ios]
//
// Exit 0 = valid; exit 1 = invalid (or could not validate). On success prints a
// one-line OK summary; on failure prints every problem found.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getConfig, ConfigError } from './config.mjs';
import { AuthError } from './token.mjs';
import { exportServiceHeaders, exportServiceRejectedAuthMessage } from './auth-mode.mjs';

class ValidateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidateError';
  }
}

const USAGE =
  'Usage: node bin/nui-validate.mjs <project.json> [--structural] [--platform android|ios]';

// The valid `kind` values (fully-qualified JavaFX class names). Mirrors
// references/project-model.md §4. An unknown kind silently falls back to a Label
// on the server, so we flag it here before that happens.
const VALID_KINDS = new Set([
  // layout / containers
  'javafx.scene.layout.Pane',
  'javafx.scene.layout.StackPane',
  'javafx.scene.layout.HBox',
  'javafx.scene.layout.VBox',
  'javafx.scene.layout.Region',
  'javafx.scene.layout.FlowPane',
  'javafx.scene.layout.BorderPane',
  'javafx.scene.layout.GridPane',
  'javafx.scene.layout.AnchorPane',
  'javafx.scene.layout.TilePane',
  'javafx.scene.Group',
  'javafx.scene.text.TextFlow',
  // controls
  'javafx.scene.control.Label',
  'javafx.scene.control.Button',
  'javafx.scene.control.ToggleButton',
  'javafx.scene.control.CheckBox',
  'javafx.scene.control.RadioButton',
  'javafx.scene.control.ComboBox',
  'javafx.scene.control.ListView',
  'javafx.scene.control.TableView',
  'javafx.scene.control.TreeView',
  'javafx.scene.control.TreeTableView',
  'javafx.scene.control.TabPane',
  'javafx.scene.control.Accordion',
  'javafx.scene.control.TitledPane',
  'javafx.scene.control.SplitPane',
  'javafx.scene.control.ScrollPane',
  'javafx.scene.control.TextField',
  'javafx.scene.control.PasswordField',
  'javafx.scene.control.TextArea',
  'javafx.scene.control.Hyperlink',
  'javafx.scene.control.Separator',
  'javafx.scene.control.ProgressBar',
  'javafx.scene.control.ProgressIndicator',
  'javafx.scene.control.Slider',
  // shapes
  'javafx.scene.shape.Rectangle',
  'javafx.scene.shape.Circle',
  'javafx.scene.shape.Ellipse',
  'javafx.scene.shape.Line',
  'javafx.scene.shape.Polygon',
  'javafx.scene.shape.Polyline',
  'javafx.scene.shape.Path',
  'javafx.scene.text.Text',
  // image
  'javafx.scene.image.ImageView',
]);

const LETTER_FIRST_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

function parseArgs(argv) {
  let project;
  let structuralOnly = false;
  let platform = 'android';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--structural') {
      structuralOnly = true;
    } else if (a === '--platform' || a === '-p') {
      platform = String(argv[++i] || '').toLowerCase();
    } else if (a === '-h' || a === '--help') {
      throw new ValidateError(USAGE);
    } else if (a.startsWith('-')) {
      throw new ValidateError(`Unknown flag: ${a}\n${USAGE}`);
    } else if (!project) {
      project = a;
    } else {
      throw new ValidateError(`Unexpected argument: ${a}\n${USAGE}`);
    }
  }
  if (!project) throw new ValidateError(`Missing <project.json>.\n${USAGE}`);
  if (platform !== 'android' && platform !== 'ios') {
    throw new ValidateError(`--platform must be 'android' or 'ios' (got '${platform}').`);
  }
  return { project, structuralOnly, platform };
}

// Walk a node subtree, collecting structural problems. `where` is a human path.
function validateNode(node, where, problems, stats) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    problems.push(`${where}: expected a node object, got ${Array.isArray(node) ? 'array' : typeof node}`);
    return;
  }
  stats.nodes++;

  // kind: required, must be a known FQCN.
  if (typeof node.kind !== 'string' || !node.kind.trim()) {
    problems.push(`${where}: missing/empty "kind" (must be a fully-qualified JavaFX class name)`);
  } else if (!VALID_KINDS.has(node.kind)) {
    problems.push(
      `${where}: unknown "kind" "${node.kind}" — not a recognized JavaFX class (will fall back to Label). ` +
        `See project-model.md §4.`
    );
  }

  // id: optional, but when present must be letter-first.
  if (node.id !== undefined && node.id !== null) {
    if (typeof node.id !== 'string') {
      problems.push(`${where}: "id" must be a string`);
    } else if (node.id.trim() && !LETTER_FIRST_ID.test(node.id.trim())) {
      problems.push(
        `${where}: id "${node.id}" is not letter-first / alphanumeric — ids must start with a letter ` +
          `(a-z/A-Z) so the native typed accessor is valid.`
      );
    } else if (node.id.trim()) {
      if (stats.ids.has(node.id)) problems.push(`${where}: duplicate id "${node.id}"`);
      stats.ids.add(node.id);
    }
  }

  // children must be an array of nodes when present.
  if (node.children !== undefined && node.children !== null) {
    if (!Array.isArray(node.children)) {
      problems.push(`${where}.children: expected an array`);
    } else {
      node.children.forEach((c, i) => validateNode(c, `${where}.children[${i}]`, problems, stats));
    }
  }
  // graphicNode / clipNode are single nested nodes when present.
  for (const slot of ['graphicNode', 'clipNode']) {
    if (node[slot] !== undefined && node[slot] !== null) {
      validateNode(node[slot], `${where}.${slot}`, problems, stats);
    }
  }

  // A few obvious type slips on common numeric fields.
  for (const f of ['layoutX', 'layoutY', 'width', 'height', 'prefWidth', 'prefHeight', 'opacity', 'fontSize']) {
    if (node[f] !== undefined && node[f] !== null && typeof node[f] !== 'number') {
      problems.push(`${where}.${f}: expected a number, got ${typeof node[f]}`);
    }
  }
}

function validateStructure(project) {
  const problems = [];
  const stats = { nodes: 0, ids: new Set(), stages: 0 };

  if (project === null || typeof project !== 'object' || Array.isArray(project)) {
    problems.push('top-level: project.json must be a JSON object');
    return { problems, stats };
  }

  // version: integer (current schema is 4; we accept any positive int but flag oddities).
  if (typeof project.version !== 'number' || !Number.isInteger(project.version)) {
    problems.push('top-level: "version" must be an integer (current schema version is 4)');
  } else if (project.version < 1 || project.version > 4) {
    problems.push(
      `top-level: "version" is ${project.version} — supported range is 1..4 (current = 4). ` +
        `Don't bump it by hand.`
    );
  }

  // stages[]: non-empty array, each with non-empty rootNodes[].
  if (!Array.isArray(project.stages) || project.stages.length === 0) {
    problems.push('top-level: "stages" must be a non-empty array (one per screen)');
  } else {
    project.stages.forEach((stage, si) => {
      const where = `stages[${si}]`;
      if (stage === null || typeof stage !== 'object' || Array.isArray(stage)) {
        problems.push(`${where}: expected a stage object`);
        return;
      }
      stats.stages++;
      if (stage.name !== undefined && typeof stage.name !== 'string') {
        problems.push(`${where}.name: must be a string`);
      }
      if (stage.stageId !== undefined && stage.stageId !== null && typeof stage.stageId !== 'string') {
        problems.push(`${where}.stageId: must be a string`);
      }
      for (const f of ['stageWidth', 'stageHeight']) {
        if (stage[f] !== undefined && stage[f] !== null && typeof stage[f] !== 'number') {
          problems.push(`${where}.${f}: expected a number`);
        }
      }
      if (!Array.isArray(stage.rootNodes) || stage.rootNodes.length === 0) {
        problems.push(`${where}.rootNodes: must be a non-empty array`);
      } else {
        stage.rootNodes.forEach((n, ni) =>
          validateNode(n, `${where}.rootNodes[${ni}]`, problems, stats)
        );
      }
    });
  }

  // libraryItems / webFonts: when present, must be arrays.
  if (project.libraryItems !== undefined && project.libraryItems !== null && !Array.isArray(project.libraryItems)) {
    problems.push('top-level: "libraryItems" must be an array when present');
  }
  if (project.webFonts !== undefined && project.webFonts !== null && !Array.isArray(project.webFonts)) {
    problems.push('top-level: "webFonts" must be an array when present');
  }

  return { problems, stats };
}

// Authoritative model round-trip: the manifest endpoint deserializes the body into
// the real ProjectState and re-serializes a file manifest. 200 = accepted; 400 =
// rejected (real failure). Returns { ok, detail }.
async function modelRoundTrip(projectBody, platform) {
  const config = await getConfig();
  const url = `${config.exportServiceUrl}/export/${platform}/manifest`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: await exportServiceHeaders(config, {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: projectBody,
    });
  } catch (e) {
    throw new ValidateError(`Network error contacting export service for model validation: ${e.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new AuthError(exportServiceRejectedAuthMessage(config, 'Model validation'));
  }
  const text = await res.text().catch(() => '');
  if (res.status === 400) {
    return { ok: false, detail: `exporter rejected the project (HTTP 400): ${text.slice(0, 400)}` };
  }
  if (!res.ok) {
    return { ok: false, detail: `model validation failed (HTTP ${res.status}): ${text.slice(0, 400)}` };
  }
  return { ok: true, detail: 'model round-trip accepted by the exporter' };
}

async function main() {
  try {
    const { project, structuralOnly, platform } = parseArgs(process.argv.slice(2));

    let body;
    try {
      body = await fs.readFile(project, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') throw new ValidateError(`Project file not found: ${project}`);
      throw new ValidateError(`Could not read ${project}: ${e.message}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      throw new ValidateError(`${project} is not valid JSON: ${e.message}`);
    }

    // ---- Layer 1: structural ----
    const { problems, stats } = validateStructure(parsed);
    if (problems.length) {
      process.stderr.write(
        `INVALID: ${path.basename(project)} failed structural validation (${problems.length} problem(s)):\n`
      );
      for (const p of problems) process.stderr.write(`  - ${p}\n`);
      process.exit(1);
    }

    // ---- Layer 2: authoritative model round-trip (unless --structural) ----
    let modelNote;
    if (structuralOnly) {
      modelNote = 'model round-trip SKIPPED (--structural) — structural-only, not a full model check';
    } else {
      try {
        const result = await modelRoundTrip(body, platform);
        if (!result.ok) {
          process.stderr.write(
            `INVALID: ${path.basename(project)} passed structural checks but the model REJECTED it:\n` +
              `  - ${result.detail}\n`
          );
          process.exit(1);
        }
        modelNote = result.detail;
      } catch (err) {
        if (err instanceof ConfigError || err instanceof AuthError) {
          // Not configured / not logged in: can't do the authoritative check, but
          // structural already passed. Report clearly and EXIT NON-ZERO so the
          // caller knows the model check did not run (fail-closed on uncertainty).
          const message = String(err.message || '');
          const remedy = message.includes('exportAuthMode="none"')
            ? `  -> Confirm the approved internal/self-host export service accepts this request, ` +
              `or switch exportAuthMode back to "nativeui".\n`
            : `  -> Log in (node bin/login.mjs) and re-run, or run with --structural to accept ` +
              `structural-only validation.\n`;
          process.stderr.write(
            `Structural checks PASSED, but the authoritative model round-trip could NOT run:\n` +
              `  ${message.split('\n').join('\n  ')}\n` +
              remedy
          );
          process.exit(1);
        }
        throw err;
      }
    }

    process.stdout.write(
      `OK: ${path.basename(project)} is valid` +
        ` (stages: ${stats.stages}, nodes: ${stats.nodes}). ${modelNote}.\n`
    );
    process.exit(0);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof AuthError || err instanceof ValidateError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

main();
