import { createAuthenticationFlow } from './authentication.mjs';
import { preflight } from '../lib/preflight.mjs';
import { importHtmlToFile } from '../lib/import.mjs';
import { runCli, jsonOutput } from '../lib/cli.mjs';
import { ErrorCode, ServiceError, serviceError } from '../lib/errors.mjs';

const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = (description) => ({ type: 'string', description });
const boolean = (description) => ({ type: 'boolean', description });
const integer = (description, minimum) => ({ type: 'integer', description, ...(minimum === undefined ? {} : { minimum }) });

function argsToFlags(values = {}, allowed = {}) {
  const flags = [];
  for (const [key, flag] of Object.entries(allowed)) {
    const value = values[key];
    if (value === undefined || value === null || value === false || value === '') continue;
    if (value === true) flags.push(flag);
    else if (Array.isArray(value)) for (const item of value) flags.push(flag, String(item));
    else flags.push(flag, String(value));
  }
  return flags;
}

async function cli(script, args, { json = false } = {}) {
  const result = await runCli(script, args);
  return json ? jsonOutput(result) : { output: result.stdout.trim() };
}

async function exportProject(args) {
  const targetArgs = args.allTargets ? ['--all-targets'] : (args.targets || []).flatMap((target) => ['--target', target]);
  if (!targetArgs.length) throw new ServiceError(ErrorCode.INVALID_PROJECT, 'Provide targets or set allTargets to true.');
  const optionFlags = argsToFlags(args.options, {
    appName: '--app-name', androidPackage: '--android-package', iosBundleId: '--ios-bundle-id', iosLayoutMode: '--ios-layout', androidLayoutMode: '--android-layout', iosControlMode: '--ios-controls', versionName: '--version-name', versionCode: '--version-code', iosBuildNumber: '--ios-build-number', androidMinSdk: '--android-min-sdk', androidTargetSdk: '--android-target-sdk', androidCompileSdk: '--android-compile-sdk', iosDeploymentTarget: '--ios-deployment-target', developmentTeam: '--development-team', allowDebugCleartextHttp: '--allow-debug-cleartext-http',
  });
  const result = await runCli('nui-export.mjs', [args.projectPath, ...targetArgs, '-o', args.outDir, ...(args.manifestOnly ? ['--manifest'] : []), '--mode', args.mode || 'prod', ...(args.force ? ['--force'] : []), ...optionFlags]);
  const requests = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/(?:Wrote|Exported)\s+([^\s]+).*?->\s+(.+?)\s+\((\d+) bytes\)/);
    if (match) requests.push({ key: match[1], outPath: match[2], bytes: Number(match[3]) });
  }
  return { requests, output: result.stdout.trim() };
}

function buildTools(auth) { return [
  { name: 'nativeui_login_start', description: 'Start or resume NativeUI browser device login and return the URL, approval code, and next MCP call.', inputSchema: object({}), handler: auth.beginLogin },
  { name: 'nativeui_login_wait', description: 'Wait a bounded time for a NativeUI device-login approval.', inputSchema: object({ deviceCode: string('Device code from nativeui_login_start.'), timeoutSeconds: integer('Maximum wait in seconds; defaults to 90.', 1) }, ['deviceCode']), handler: ({ deviceCode, timeoutSeconds = 90 }) => auth.waitForLogin(deviceCode, { timeoutMs: Math.min(timeoutSeconds, 900) * 1000 }) },
  { name: 'nativeui_auth_status', description: 'Verify NativeUI session readiness and state the exact login sequence if authentication is needed.', inputSchema: object({}), handler: auth.status },
  { name: 'nativeui_logout', description: 'Remove local NativeUI credentials.', inputSchema: object({}), handler: auth.signOut },
  { name: 'nativeui_preflight', description: 'Verify NativeUI service configuration and authenticated login readiness; begins browser login if needed.', inputSchema: object({}), exportOnlyAllowed: true, handler: preflight },
  { name: 'nativeui_import_html', description: 'Verify login, then import one or more local HTML files into project JSON.', inputSchema: object({ htmlFiles: { type: 'array', items: string('HTML file path.') }, outPath: string('Output project.json path.') }, ['htmlFiles']), exportOnlyAllowed: true, handler: importHtmlToFile },
  { name: 'nativeui_export', description: 'Verify login, then export project JSON to one or more NativeUI targets, preserving developer-owned seams by default.', inputSchema: object({ projectPath: string('Project JSON path.'), outDir: string('Output directory.'), targets: { type: 'array', items: string('NativeUI target ID.') }, allTargets: boolean('Export all supported targets.'), manifestOnly: boolean('Write manifests rather than archives.'), mode: { type: 'string', enum: ['beta', 'prod'] }, force: boolean('Overwrite protected seams.'), options: { type: 'object' } }, ['projectPath', 'outDir']), exportOnlyAllowed: true, handler: exportProject },
  { name: 'nativeui_validate', description: 'Verify login, then validate project JSON structurally or against the hosted model.', inputSchema: object({ projectPath: string('Project JSON path.'), structuralOnly: boolean('Skip hosted model validation.'), platform: { type: 'string', enum: ['android', 'ios'] } }, ['projectPath']), exportOnlyAllowed: true, handler: async (args) => cli('nui-validate.mjs', [args.projectPath, ...(args.structuralOnly ? ['--structural'] : []), ...(args.platform ? ['--platform', args.platform] : [])]) },
  { name: 'nativeui_save_project', description: 'Create or update a cloud project by name.', inputSchema: object({ projectPath: string('Project JSON path.'), name: string('Cloud project name.'), location: string('Optional cloud folder.') }, ['projectPath', 'name']), handler: async (args) => cli('nui-save.mjs', [args.projectPath, '--name', args.name, ...argsToFlags(args, { location: '--location' })]) },
  { name: 'nativeui_preview', description: 'Save a cloud project and return the web-editor preview location without opening a browser.', inputSchema: object({ projectPath: string('Project JSON path.'), name: string('Cloud project name.'), location: string('Optional cloud folder.') }, ['projectPath', 'name']), handler: async (args) => cli('nui-preview.mjs', [args.projectPath, '--name', args.name, ...argsToFlags(args, { location: '--location' })]) },
  { name: 'nativeui_project_status', description: 'Compare local project content with the cloud revision.', inputSchema: object({ projectPath: string('Project JSON path.'), projectId: string('Cloud project ID.'), name: string('Cloud project name.') }, ['projectPath']), handler: async (args) => cli('nui-project-sync.mjs', ['status', args.projectPath, ...argsToFlags(args, { projectId: '--project-id', name: '--name' })], { json: true }) },
  { name: 'nativeui_project_sync', description: 'Reconcile a named cloud project safely: pull cloud-only edits, push local-only edits, and stop on conflicts.', inputSchema: object({ projectPath: string('Project JSON path.'), name: string('Cloud project name.'), projectId: string('Optional cloud project ID.'), location: string('Optional cloud folder when creating or moving the project.') }, ['projectPath', 'name']), handler: async (args) => cli('nui-project-sync.mjs', ['sync', args.projectPath, '--name', args.name, ...argsToFlags(args, { projectId: '--project-id', location: '--location' })], { json: true }) },
  { name: 'nativeui_project_pull', description: 'Pull cloud project content and update its local sync sidecar.', inputSchema: object({ projectPath: string('Project JSON path.'), projectId: string('Cloud project ID.'), name: string('Cloud project name.') }, ['projectPath']), handler: async (args) => cli('nui-project-sync.mjs', ['pull', args.projectPath, ...argsToFlags(args, { projectId: '--project-id', name: '--name' })], { json: true }) },
  { name: 'nativeui_project_push', description: 'Push local project content with revision-conflict protection.', inputSchema: object({ projectPath: string('Project JSON path.'), name: string('Cloud project name.'), projectId: string('Optional cloud project ID.'), location: string('Optional cloud folder.') }, ['projectPath', 'name']), handler: async (args) => cli('nui-project-sync.mjs', ['push', args.projectPath, '--name', args.name, ...argsToFlags(args, { projectId: '--project-id', location: '--location' })], { json: true }) },
  { name: 'nativeui_library_upsert', description: 'Add or update non-secret API/database library configuration in project JSON.', inputSchema: object({ command: { type: 'string', enum: ['upsert-api', 'upsert-database'] }, projectPath: string('Project JSON path.'), name: string('Library item name.'), options: { type: 'object' } }, ['command', 'projectPath', 'name']), handler: async ({ command, projectPath, name, options = {} }) => cli('nui-library.mjs', [command, projectPath, '--name', name, ...Object.entries(options).flatMap(([key, value]) => value === undefined ? [] : [`--${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`, String(value)]), '--json'], { json: true }) },
  { name: 'nativeui_library_secret_status', description: 'Check whether a library secret is configured. Secret values never enter MCP.', inputSchema: object({ projectId: string('Cloud project ID.'), itemId: string('Library item ID.') }, ['projectId', 'itemId']), handler: async (args) => cli('nui-library.mjs', ['secret-status', ...argsToFlags(args, { projectId: '--project-id', itemId: '--item-id' }), '--json'], { json: true }) },
  { name: 'nativeui_library_test', description: 'Test a configured API/database library item without sending a secret through MCP.', inputSchema: object({ projectId: string('Cloud project ID.'), itemId: string('Library item ID.'), kind: { type: 'string', enum: ['api', 'database'] }, config: { type: 'object' } }, ['projectId', 'itemId', 'kind', 'config']), handler: async (args) => cli('nui-library.mjs', ['test', ...argsToFlags(args, { projectId: '--project-id', itemId: '--item-id', kind: '--kind' }), '--config-json', JSON.stringify(args.config), '--json'], { json: true }) },
  { name: 'nativeui_fragment_extract', description: 'Export a node subtree to editable HTML.', inputSchema: object({ projectPath: string('Project JSON path.'), nodeId: string('Node ID.'), outPath: string('Output HTML path.') }, ['projectPath', 'nodeId']), handler: async (args) => cli('nui-fragment-extract.mjs', [args.projectPath, '--id', args.nodeId, ...argsToFlags(args, { outPath: '--output' })]) },
  {
    name: 'nativeui_fragment_import',
    description: 'Import HTML into a node-subtree payload or atomically replace/append one project node.',
    inputSchema: object({
      snippetPath: string('HTML snippet path.'),
      outPath: string('Output JSON path when not updating a project.'),
      nodesOnly: boolean('Write only the root-node array when not updating a project.'),
      projectPath: string('Existing project.json to update atomically.'),
      replaceNodeId: string('Stable node id to replace while preserving its identity.'),
      appendToNodeId: string('Stable parent node id whose children receive the fragment.'),
      recipePath: string('Optional metadata/style-token recipe JSON path.'),
      updateSharedLibrary: boolean('Allow replacement of colliding shared Library artifacts.'),
      dryRun: boolean('Validate and report without writing the project.'),
    }, ['snippetPath']),
    handler: async (args) => cli('nui-fragment-import.mjs', [
      args.snippetPath,
      ...argsToFlags(args, {
        outPath: '--output',
        nodesOnly: '--nodes-only',
        projectPath: '--project',
        replaceNodeId: '--replace',
        appendToNodeId: '--append-to',
        recipePath: '--recipe',
        updateSharedLibrary: '--update-shared-library',
        dryRun: '--dry-run',
      }),
    ]),
  },
  { name: 'nativeui_screen_extract', description: 'Export one stage to editable HTML.', inputSchema: object({ projectPath: string('Project JSON path.'), stage: string('Stage ID, name, or one-based index.'), outPath: string('Output HTML path.') }, ['projectPath', 'stage']), handler: async (args) => cli('nui-screen-extract.mjs', [args.projectPath, '--stage', args.stage, ...argsToFlags(args, { outPath: '--output' })]) },
  { name: 'nativeui_screen_update', description: 'Replace one stage from HTML while preserving other stages.', inputSchema: object({ projectPath: string('Project JSON path.'), htmlPath: string('Edited screen HTML path.'), stage: string('Stage ID, name, or one-based index.'), rename: string('Optional stage name.'), replaceStageInteractions: boolean('Replace rather than merge interactions.'), updateSharedLibrary: boolean('Update matching shared library items.'), dryRun: boolean('Validate without writing.') }, ['projectPath', 'htmlPath', 'stage']), handler: async (args) => cli('nui-screen-update.mjs', [args.projectPath, args.htmlPath, '--stage', args.stage, ...argsToFlags(args, { rename: '--rename', replaceStageInteractions: '--replace-stage-interactions', updateSharedLibrary: '--update-shared-library', dryRun: '--dry-run' })]) },
  { name: 'nativeui_report_parity', description: 'Send a NativeUI parity report to the hosted issue service.', inputSchema: object({ title: string('Concise parity issue title.'), description: string('Observed mismatch and expected result.'), projectPath: string('Optional project JSON attachment.') }, ['title']), handler: async (args) => cli('nui-report-parity.mjs', ['--title', args.title, ...argsToFlags(args, { description: '--description', projectPath: '--project' })]) },
]; }

export function checkArgs(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ServiceError(ErrorCode.INVALID_PROJECT, 'Tool arguments must be an object.');
  for (const key of schema.required || []) if (args[key] === undefined) throw new ServiceError(ErrorCode.INVALID_PROJECT, `Missing required argument: ${key}.`);
  if (schema.additionalProperties === false) for (const key of Object.keys(args)) if (!Object.hasOwn(schema.properties || {}, key)) throw new ServiceError(ErrorCode.INVALID_PROJECT, `Unknown argument: ${key}.`);
}

export function createTools({ auth = createAuthenticationFlow() } = {}) {
  const registered = buildTools(auth);
  const authenticationTools = new Set(['nativeui_login_start', 'nativeui_login_wait', 'nativeui_auth_status', 'nativeui_logout']);
  return {
    tools: registered,
    listTools: () => registered.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    async callTool(name, args = {}) {
      const tool = registered.find((entry) => entry.name === name);
      if (!tool) throw new ServiceError(ErrorCode.SERVICE_REJECTED, `Unknown NativeUI tool: ${name}`);
      checkArgs(tool.inputSchema, args);
      // Every NativeUI operation other than the login lifecycle first verifies a fresh session.
      // Export-only installations are deliberately exempted by the shared auth flow.
      if (!authenticationTools.has(name)) await auth.ensureAuthenticated({ allowExportOnly: tool.exportOnlyAllowed === true, feature: tool.name });
      return tool.handler(args);
    },
  };
}

const defaultTools = createTools();
export const tools = defaultTools.tools;
export const listTools = defaultTools.listTools;
export const callTool = defaultTools.callTool;

export function toToolResult(error) {
  const failure = serviceError(error);
  const errorPayload = { code: failure.code, message: failure.message, remedy: failure.remedy || 'Correct the request and retry.' };
  if (failure.login) errorPayload.login = failure.login;
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: errorPayload }) }] };
}
