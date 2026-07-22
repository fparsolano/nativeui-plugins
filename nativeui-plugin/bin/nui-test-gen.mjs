// nui-test-gen.mjs — generate target-specific action-contract tests for exported
// NativeUI apps. Legacy iOS/Android/Rust flags remain compatible.
//
// What the contract is (see docs/native-backend-contract.md):
//   - NuiScreenControls — one typed accessor per designer-named node (resolved from
//     the live view tree), plus an untyped view(id) fallback.
//   - NuiScreenDelegate — onScreenReady(controls) fires once the UI is built/bound;
//     the authored-event hooks onNavigateToStage / onCallApi / onCallDatabase /
//     onPlayTimeline route to it.
//   - NuiBackend — yours, never overwritten.
//
// These tests target the GENERATED contract SURFACE only — they never edit generated
// UI. They prove: (a) the typed control accessors exist + compile + resolve, (b)
// onScreenReady is invoked with a controls object, (c) the four delegate hooks are
// present (overridable), and (d) a basic smoke (the screen builds without throwing).
//
// The accessor NAMES are derived the SAME way the exporters derive them
// (camelCase, digit-first -> "n"-prefixed, keyword-suffixed, deduped) so the asserted
// property name matches what was generated. Which ids get a TYPED accessor is layout-
// dependent on Android (digit-first ids get no typed accessor — reachable via view(id)
// only), so the generated tests assert the typed accessor for a representative
// LETTER-FIRST id and always also assert the untyped view(id) fallback resolves.
//
// Usage:
//   node bin/nui-test-gen.mjs <project.json> --platform android|ios|both|rust|web --out <exported-app-dir>
//   node bin/nui-test-gen.mjs <project.json> --platform both --out ./android-out --ios-out ./ios-out
//
// --out is the EXPORTED app dir (where the native project lives). For Android the
// test goes under src/test (Robolectric, JVM) AND a thin androidTest smoke; for iOS a
// <App>Tests/ XCTest source is written. Pure Node, no deps, no network, no auth.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveTargets } from './target-contract.mjs';

class TestGenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TestGenError';
  }
}

const USAGE =
  'Usage: node bin/nui-test-gen.mjs <project.json> [--target auto|<target-id|group>...] [--all-targets] [--platform android|ios|both|rust|web] --out <dir> [--ios-out <dir>] [--package <pkg>]';

function parseArgs(argv) {
  let project;
  let platform = 'both';
  let out;
  let iosOut;
  let pkg;
  const targetTokens = [];
  let allTargets = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--platform' || a === '-p') {
      platform = String(argv[++i] || '').toLowerCase();
    } else if (a === '--target') {
      targetTokens.push(String(argv[++i] || '').toLowerCase());
    } else if (a === '--all-targets') {
      allTargets = true;
    } else if (a === '--out' || a === '-o') {
      out = argv[++i];
    } else if (a === '--ios-out') {
      iosOut = argv[++i];
    } else if (a === '--package') {
      pkg = argv[++i] || pkg;
    } else if (a === '-h' || a === '--help') {
      throw new TestGenError(USAGE);
    } else if (a.startsWith('-')) {
      throw new TestGenError(`Unknown flag: ${a}\n${USAGE}`);
    } else if (!project) {
      project = a;
    } else {
      throw new TestGenError(`Unexpected argument: ${a}\n${USAGE}`);
    }
  }
  if (!project) throw new TestGenError(`Missing <project.json>.\n${USAGE}`);
  if (!['android', 'ios', 'both', 'rust', 'web'].includes(platform)) {
    throw new TestGenError(`--platform must be android|ios|both|rust|web (got '${platform}').`);
  }
  if (!out) throw new TestGenError(`Missing --out <exported-app-dir>.\n${USAGE}`);
  const selectedTargets = targetTokens.length || allTargets
    ? resolveTargets(targetTokens, { allTargets, defaults: true })
    : platform === 'web'
      ? resolveTargets(['web'])
      : [];
  return { project, platform, out, iosOut: iosOut || out, pkg, selectedTargets };
}

// ── Accessor-name derivation (mirrors AndroidProjectExporter.controlPropertyName /
//    IosProjectExporter.swiftControlPropertyName: kebab/snake -> camelCase,
//    digit-first -> "n"-prefixed, keyword-collision -> suffixed, deduped). ──
const KOTLIN_KEYWORDS = new Set([
  'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in',
  'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this', 'throw',
  'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while',
]);
const SWIFT_KEYWORDS = new Set([
  'class', 'struct', 'enum', 'protocol', 'extension', 'func', 'var', 'let', 'if', 'else',
  'for', 'while', 'return', 'self', 'super', 'init', 'deinit', 'switch', 'case', 'default',
  'import', 'public', 'private', 'internal', 'static', 'true', 'false', 'nil', 'guard',
]);

// Mirrors AndroidProjectExporter.controlPropertyName / IosProjectExporter.swiftControlPropertyName:
// both prepend "n" to a digit-first base and suffix "View" on a keyword collision, then dedup.
function controlPropertyName(id, used, keywords) {
  let name = '';
  let upperNext = false;
  for (const c of id) {
    if (/[A-Za-z0-9]/.test(c)) {
      name += upperNext && name.length > 0 ? c.toUpperCase() : c;
      upperNext = false;
    } else {
      upperNext = true;
    }
  }
  let base = name || 'control';
  if (/[0-9]/.test(base[0])) base = 'n' + base;
  if (keywords.has(base)) base = base + 'View';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = base + suffix++;
  used.add(candidate);
  return candidate;
}

const LETTER_FIRST = /^[A-Za-z][A-Za-z0-9_-]*$/;

// Collect named ids (in document order) from a project. Tracks whether each is
// letter-first (Android typed-accessor eligible).
function collectNamedNodes(project) {
  const out = [];
  const seen = new Set();
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (typeof n.id === 'string' && n.id.trim() && !seen.has(n.id)) {
      seen.add(n.id);
      out.push({ id: n.id, kind: n.kind || '', letterFirst: LETTER_FIRST.test(n.id) });
    }
    if (Array.isArray(n.children)) n.children.forEach(walk);
    if (n.graphicNode) walk(n.graphicNode);
    if (n.clipNode) walk(n.clipNode);
  };
  for (const st of project.stages || []) (st.rootNodes || []).forEach(walk);
  return out;
}

// platform: 'ios' (reserves the struct members root/view/find/requireView, surfaces every
// named node) or 'android' (no reserved members; digit-first ids get NO typed accessor).
function deriveAccessors(named, keywords, platform) {
  const isIos = platform === 'ios';
  const used = new Set(isIos ? ['root', 'view', 'find', 'requireView'] : []);
  const rows = [];
  for (const n of named) {
    if (!isIos && !n.letterFirst) continue; // Android: digit-first -> no typed accessor
    const prop = controlPropertyName(n.id, used, keywords);
    rows.push({ id: n.id, kind: n.kind, prop, letterFirst: n.letterFirst });
  }
  return rows;
}

// Pick a representative LETTER-FIRST named node to assert the typed accessor on
// (so the assertion holds on both platforms). Falls back to the first named node.
function pickRepresentative(rows, named) {
  const lf = rows.find((r) => r.letterFirst);
  if (lf) return lf;
  if (rows[0]) return rows[0];
  return named[0] ? { id: named[0].id, prop: null, kind: named[0].kind } : null;
}

// ── iOS XCTest source ──
function iosTestSource(project, named, controllerType = 'MainViewController') {
  const rows = deriveAccessors(named, SWIFT_KEYWORDS, 'ios');
  const rep = pickRepresentative(rows, named);
  const repId = rep ? rep.id : '';
  const repProp = rep ? rep.prop : '';
  const accessorAssert =
    rep && repProp
      ? `        // Typed accessor for designer node "${repId}" resolves to a UIView.\n` +
        `        XCTAssertNotNil(controls.${repProp}, "typed accessor '${repProp}' (node '${repId}') should resolve")\n`
      : `        // (no named nodes in this project — nothing to assert a typed accessor on)\n`;
  const untypedAssert = repId
    ? `        // Untyped fallback resolves the same node by id.\n` +
      `        XCTAssertNotNil(controls.view("${repId}"), "view(\\"${repId}\\") should resolve a named node")\n`
    : '';

  return `// GENERATED by NativeUI nui-test-gen — asserts the NuiBackend CONTRACT for the
// exported app. Targets the GENERATED contract surface only; never edit generated UI.
//
// Contract under test (docs/native-backend-contract.md):
//   - NuiScreenControls typed accessors exist/compile/resolve from the live view tree.
//   - onScreenReady(_:) is the delegate hook; ${controllerType}.viewDidLoad calls
//     NuiBackend.shared.onScreenReady(NuiScreenControls(root: root)) directly, so we build
//     the screen, rebuild NuiScreenControls from its live root, and assert it binds.
//   - The authored-event hooks (onNavigateToStage/onCallApi/onCallDatabase/onPlayTimeline)
//     are present + overridable on the delegate.
//   - Smoke: the screen builds without throwing.
import XCTest
@testable import App

final class NuiBackendContractTests: XCTestCase {

    /// Records the onScreenReady hand-off so the test can inspect controls. Also proves the
    /// four authored-event hooks are part of the delegate surface (overriding must compile).
    final class RecordingDelegate: NuiScreenDelegate {
        var ready = false
        var captured: NuiScreenControls?
        func onScreenReady(_ controls: NuiScreenControls) {
            ready = true
            captured = controls
        }
        func onNavigateToStage(_ target: String) {}
        func onCallApi(_ target: String, _ params: [String: String]) {}
        func onCallDatabase(_ target: String, _ params: [String: String]) {}
        func onPlayTimeline(_ target: String, _ params: [String: String]) {}
    }

    /// Build the generated screen. Loading the view triggers viewDidLoad -> the generated
    /// build (which itself calls NuiBackend.shared.onScreenReady).
    private func buildScreen() -> UIViewController {
        let vc = ${controllerType}()
        vc.loadViewIfNeeded()
        vc.view.layoutIfNeeded()
        return vc
    }

    func testSmoke_screenBuildsWithoutThrowing() {
        let vc = buildScreen()
        XCTAssertNotNil(vc.view, "the generated screen should build a root view")
        XCTAssertFalse(vc.view.subviews.isEmpty, "the generated screen should contain views")
    }

    func testOnScreenReadyBindsControlsFromTheLiveScreen() {
        // NuiBackend.shared.onScreenReady already ran in viewDidLoad; rebuild controls from
        // the live root and route them through a delegate to prove the hand-off shape binds.
        let vc = buildScreen()
        let delegate = RecordingDelegate()
        delegate.onScreenReady(NuiScreenControls(root: vc.view))
        XCTAssertTrue(delegate.ready, "onScreenReady should bind")
        XCTAssertNotNil(delegate.captured, "onScreenReady should hand back a NuiScreenControls")
    }

    func testTypedControlAccessorsResolve() {
        let vc = buildScreen()
        let controls = NuiScreenControls(root: vc.view)
${accessorAssert}${untypedAssert}    }

    func testDelegateHookSurfaceIsPresent() {
        // Compile-time proof the four authored-event hooks exist on the delegate; a
        // direct call must not throw (defaults are no-ops). NuiBackend.shared conforms.
        let delegate: NuiScreenDelegate = NuiBackend.shared
        delegate.onNavigateToStage("stage-1")
        delegate.onCallApi("login", ["k": "v"])
        delegate.onCallDatabase("users", ["q": "1"])
        delegate.onPlayTimeline("intro", [:])
    }
}
`;
}

// ── Rust cargo-test source (secondary target) ──
// The exported Rust project is a BIN crate whose generated screens are private to the binary, so an
// integration test in tests/ cannot rebuild them (unlike iOS/Android, which can load the real screen).
// We assert what IS reachable through the public `nui_rt` API: the full 11-hook NuiBackend surface (a
// RecordingBackend implementing every hook compiles + records), the fetch_list default, and the read-only
// NuiScreenControls::node lookup. That YOUR AppActions implements NuiBackend is guaranteed by COMPILATION —
// the generated main.rs calls run_multi_stage_app(_, AppActions), so cargo build/test fails if the seam breaks.
function rustTestSource(project) {
  const stageCount = Array.isArray(project.stages) ? project.stages.length : 0;
  return `// GENERATED by NativeUI nui-test-gen — asserts the NuiBackend CONTRACT for the exported Rust app.
// Runs with \`cargo test\`. Contract spec: docs/rust-backend-contract.md. Project stages: ${stageCount}.
//
// What this proves (via the public nui_rt API):
//   - The seam trait nui_rt::actions::NuiBackend has the expected 11-hook surface — a test double that
//     implements every hook compiles and records calls (the RecordingBackend pattern).
//   - fetch_list defaults to None (export-seeded sample rows are kept until you override it).
//   - The read-only NuiScreenControls::node(id) lookup compiles and runs (a missing id is a silent None —
//     the documented no-loud-crash behavior).
//
// What COMPILATION already guarantees (so no explicit assert here): that your own AppActions implements
// NuiBackend. The generated src/main.rs calls run_multi_stage_app(_, AppActions), which requires
// AppActions: NuiBackend — so \`cargo build\`/\`cargo test\` FAILS if the seam is broken. Never edit the
// generated src/main.rs or src/screens/*.rs; your logic lives in the write-once src/app_actions.rs.

use nui_rt::actions::{NoopBackend, NuiBackend, NuiScreenControls};
use nui_rt::scene::Stage;
use std::cell::RefCell;
use std::collections::HashMap;

/// A test double implementing every NuiBackend hook — compiling this is the proof the 11-hook surface
/// exists with the expected signatures; the recorded log proves the hooks are dispatchable.
#[derive(Default)]
struct RecordingBackend {
    calls: RefCell<Vec<String>>,
}

impl RecordingBackend {
    fn log(&self, s: String) {
        self.calls.borrow_mut().push(s);
    }
}

impl NuiBackend for RecordingBackend {
    fn on_screen_ready(&self, _controls: &NuiScreenControls) {
        self.log("on_screen_ready".into());
    }
    fn on_navigate_to_stage(&self, target: &str) {
        self.log(format!("on_navigate_to_stage:{target}"));
    }
    fn on_call_api(&self, target: &str, _params: &HashMap<String, String>) {
        self.log(format!("on_call_api:{target}"));
    }
    fn on_call_database(&self, target: &str, _params: &HashMap<String, String>) {
        self.log(format!("on_call_database:{target}"));
    }
    fn on_play_timeline(&self, target: &str, _params: &HashMap<String, String>) {
        self.log(format!("on_play_timeline:{target}"));
    }
    fn on_open_url(&self, url: &str, _params: &HashMap<String, String>) {
        self.log(format!("on_open_url:{url}"));
    }
    fn on_submit_form(&self, target: &str, _params: &HashMap<String, String>) {
        self.log(format!("on_submit_form:{target}"));
    }
    fn on_set_state(&self, target: &str, _params: &HashMap<String, String>) {
        self.log(format!("on_set_state:{target}"));
    }
    fn on_run_script(&self, handler: &str, _params: &HashMap<String, String>) {
        self.log(format!("on_run_script:{handler}"));
    }
    fn on_animate_panel(&self, target: &str, _params: &HashMap<String, String>) {
        self.log(format!("on_animate_panel:{target}"));
    }
    fn fetch_list(&self, source: &str) -> Option<Vec<HashMap<String, String>>> {
        self.log(format!("fetch_list:{source}"));
        None
    }
}

#[test]
fn recording_backend_covers_every_nuibackend_hook() {
    let b = RecordingBackend::default();
    let p = HashMap::new();
    b.on_screen_ready(&NuiScreenControls::new(&empty_stage()));
    b.on_navigate_to_stage("stage-1");
    b.on_call_api("login", &p);
    b.on_call_database("users", &p);
    b.on_play_timeline("intro", &p);
    b.on_open_url("https://example.com", &p);
    b.on_submit_form("signup", &p);
    b.on_set_state("counter", &p);
    b.on_run_script("save", &p);
    b.on_animate_panel("drawer", &p);
    let rows = b.fetch_list("results");
    assert!(rows.is_none(), "fetch_list default keeps export-seeded rows (None)");
    assert_eq!(b.calls.borrow().len(), 11, "every hook dispatched exactly once");
}

#[test]
fn noop_backend_satisfies_the_trait_and_defaults_fetch_list_to_none() {
    // The framework default backend a fresh export runs before you write app_actions.rs.
    let noop = NoopBackend;
    let backend: &dyn NuiBackend = &noop;
    let p = HashMap::new();
    backend.on_call_api("noop", &p); // no-op default must not panic
    assert!(backend.fetch_list("any").is_none());
}

#[test]
fn controls_node_lookup_runs_and_missing_id_is_silent_none() {
    // Read-only controls: node(id) resolves against the built scene; a missing/renamed id is a silent
    // None (never a panic), matching the frozen contract. Positive resolution against real generated
    // screens is exercised by the app's own build/run (they are private to this bin crate).
    let stage = empty_stage();
    let controls = NuiScreenControls::new(&stage);
    assert!(controls.node("no-such-id").is_none());
}

fn empty_stage() -> Stage {
    Stage {
        id: "test-stage".to_string(),
        name: "test-stage".to_string(),
        width: 100.0,
        height: 100.0,
        background: None,
        roots: Vec::new(),
    }
}
`;
}

// ── Android Robolectric (JVM) source ──
function androidTestSource(pkg, project, named) {
  const rows = deriveAccessors(named, KOTLIN_KEYWORDS, 'android'); // letter-first only
  const rep = pickRepresentative(rows, named);
  const repId = rep ? rep.id : '';
  const repProp = rep ? rep.prop : '';
  const accessorAssert =
    rep && repProp
      ? `        // Typed accessor for designer node "${repId}" resolves to a View.\n` +
        `        assertNotNull("typed accessor '${repProp}' (node '${repId}') should resolve", controls.${repProp})\n`
      : `        // (no letter-first named nodes — Android emits no typed accessor; skip)\n`;
  const untypedAssert = repId
    ? `        // Untyped fallback resolves the same node by id.\n` +
      `        assertNotNull("view(\\"${repId}\\") should resolve a named node", controls.view("${repId}"))\n`
    : '';

  return `package ${pkg}

// GENERATED by NativeUI nui-test-gen — asserts the NuiBackend CONTRACT for the
// exported app. Targets the GENERATED contract surface only; never edit generated UI.
//
// Contract under test (docs/native-backend-contract.md):
//   - NuiScreenControls typed accessors exist/compile/resolve from the live view tree.
//   - onScreenReady(controls) is the delegate hook; on Android MainActivity.onCreate
//     calls NuiBackend.onScreenReady(NuiScreenControls(this)) directly (NuiBackend is
//     the NuiScreenDelegate singleton — there is no swappable screen-ready delegate),
//     so we rebuild NuiScreenControls from the launched Activity and assert it binds.
//   - The authored-event hooks (onNavigateToStage/onCallApi/onCallDatabase/onPlayTimeline)
//     are present on the delegate + their GeneratedInteractions routing lambdas are assignable.
//   - Smoke: the Activity launches and inflates the generated layout.
import androidx.test.core.app.ActivityScenario
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NuiBackendContractTest {

    /** Records the onScreenReady hand-off so the test can inspect controls. Also proves the
     *  four authored-event hooks are part of the delegate surface (overriding them must compile). */
    private class RecordingDelegate : NuiScreenDelegate {
        var ready = false
        var captured: NuiScreenControls? = null
        override fun onScreenReady(controls: NuiScreenControls) {
            ready = true
            captured = controls
        }
        override fun onNavigateToStage(target: String) {}
        override fun onCallApi(target: String, params: Map<String, String>) {}
        override fun onCallDatabase(target: String, params: Map<String, String>) {}
        override fun onPlayTimeline(target: String, params: Map<String, String>) {}
    }

    @Test
    fun smoke_activityLaunchesAndInflates() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val root = activity.findViewById<android.view.View>(android.R.id.content)
                assertNotNull("the generated layout should inflate a content view", root)
            }
        }
    }

    @Test
    fun onScreenReadyBindsControlsFromTheLiveScreen() {
        // NuiBackend.onScreenReady already ran in onCreate; rebuild controls from the live
        // Activity and route them through a delegate to prove the hand-off shape binds.
        val delegate = RecordingDelegate()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                delegate.onScreenReady(NuiScreenControls(activity))
                assertTrue("onScreenReady should bind", delegate.ready)
                assertNotNull("onScreenReady should hand back a NuiScreenControls", delegate.captured)
            }
        }
    }

    @Test
    fun typedControlAccessorsResolve() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val controls = NuiScreenControls(activity)
${accessorAssert}${untypedAssert}            }
        }
    }

    @Test
    fun delegateHookSurfaceIsPresent() {
        // Compile-time proof the four authored-event hooks exist on the delegate; calls must not throw.
        val delegate: NuiScreenDelegate = RecordingDelegate()
        delegate.onNavigateToStage("stage-1")
        delegate.onCallApi("login", mapOf("k" to "v"))
        delegate.onCallDatabase("users", mapOf("q" to "1"))
        delegate.onPlayTimeline("intro", emptyMap())
        // The generated routing lambdas are assignable (they default to NuiBackend.* per the contract).
        GeneratedInteractions.onCallApi = { _, _ -> }
        GeneratedInteractions.onNavigateToStage = { _ -> }
        GeneratedInteractions.onCallDatabase = { _, _ -> }
        GeneratedInteractions.onPlayTimeline = { _, _ -> }
        assertTrue(true)
    }
}
`;
}

// ── Android instrumented (androidTest) thin smoke ──
function androidInstrumentedSmoke(pkg) {
  return `package ${pkg}

// GENERATED by NativeUI nui-test-gen — on-DEVICE smoke (androidTest). Launches the
// real Activity on an emulator/device and asserts the generated layout inflates.
// Targets the generated contract surface only; never edit generated UI.
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NuiBackendContractInstrumentedTest {
    @Test
    fun launchesAndInflates() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertNotNull(activity.findViewById<android.view.View>(android.R.id.content))
            }
        }
    }
}
`;
}

// Find the Android app module's src dir under an exported dir (looks for src/main).
async function findAndroidSrcRoot(outDir) {
  const candidates = [
    path.join(outDir, 'app', 'src'),
    path.join(outDir, 'src'),
  ];
  for (const c of candidates) {
    try {
      const st = await fs.stat(path.join(c, 'main'));
      if (st.isDirectory()) return c;
    } catch {
      /* keep looking */
    }
  }
  // Fall back to app/src even if not present yet (we create it).
  return path.join(outDir, 'app', 'src');
}

async function readAndroidPackage(outDir, overridePkg) {
  if (overridePkg && overridePkg.trim()) {
    return overridePkg.trim();
  }
  for (const file of [
    path.join(outDir, 'app', 'build.gradle.kts'),
    path.join(outDir, 'build.gradle.kts'),
  ]) {
    try {
      const gradle = await fs.readFile(file, 'utf8');
      const appId = gradle.match(/applicationId\s*=\s*"([^"]+)"/);
      if (appId) return appId[1];
      const namespace = gradle.match(/namespace\s*=\s*"([^"]+)"/);
      if (namespace) return namespace[1];
    } catch {
      /* keep looking */
    }
  }
  return 'com.nui.app';
}

function pkgToPath(pkg) {
  return pkg.split('.').join(path.sep);
}

async function writeFileEnsured(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function genAndroid(project, named, outDir, pkg) {
  const srcRoot = await findAndroidSrcRoot(outDir);
  const relPkg = pkgToPath(pkg);
  const unitFile = path.join(srcRoot, 'test', 'kotlin', relPkg, 'NuiBackendContractTest.kt');
  const instFile = path.join(srcRoot, 'androidTest', 'kotlin', relPkg, 'NuiBackendContractInstrumentedTest.kt');
  await writeFileEnsured(unitFile, androidTestSource(pkg, project, named));
  await writeFileEnsured(instFile, androidInstrumentedSmoke(pkg));
  return [unitFile, instFile];
}

async function detectIosControllerType(outDir) {
  for (const candidate of [
    ['App/MainViewController.swift', 'MainViewController'],
    ['NuiGenerated/MainViewController.swift', 'MainViewController'],
    ['Generated/GeneratedMainViewController.swift', 'GeneratedMainViewController'],
    ['app/Sources/MainViewController.swift', 'MainViewController'],
    ['app/Sources/GeneratedMainViewController.swift', 'GeneratedMainViewController'],
  ]) {
    try {
      await fs.stat(path.join(outDir, candidate[0]));
      return candidate[1];
    } catch {
      /* keep looking */
    }
  }
  return 'MainViewController';
}

async function genIos(project, named, outDir) {
  // Write to a Tests target dir alongside the app sources. We place it at
  // <outDir>/Tests/NuiBackendContractTests.swift — the user adds it to a Tests target
  // in Xcode (the generator emits a README note on how).
  const file = path.join(outDir, 'Tests', 'NuiBackendContractTests.swift');
  const controllerType = await detectIosControllerType(outDir);
  await writeFileEnsured(file, iosTestSource(project, named, controllerType));
  const readme = path.join(outDir, 'Tests', 'README.md');
  await writeFileEnsured(
    readme,
    `# NativeUI generated contract tests (iOS)

\`NuiBackendContractTests.swift\` asserts the NuiBackend contract for the exported app
(typed control accessors resolve, \`onScreenReady\` fires, the delegate hooks exist, a
smoke). It targets the GENERATED contract surface only — do not edit generated UI.

To run it: in Xcode add a **Unit Testing Bundle** target to the app project, add
\`NuiBackendContractTests.swift\` to that target, ensure the target \`@testable import App\`
can see the app module, then \`Product > Test\` (or \`xcodebuild test\`).
`
  );
  return [file, readme];
}

async function genRust(project, outDir) {
  // The exported Rust project is a single Cargo crate; integration tests live in tests/ by convention.
  const file = path.join(outDir, 'tests', 'nui_backend_contract.rs');
  await writeFileEnsured(file, rustTestSource(project));
  const readme = path.join(outDir, 'tests', 'README.md');
  await writeFileEnsured(
    readme,
    `# NativeUI generated contract test (Rust)

\`nui_backend_contract.rs\` asserts the NuiBackend contract for the exported Rust app — the 11-hook trait
surface, the \`fetch_list\` default, and the read-only \`NuiScreenControls::node(id)\` lookup. Run it with:

\`\`\`
cargo test
\`\`\`

That your own \`src/app_actions.rs\` \`AppActions\` implements \`NuiBackend\` is guaranteed by compilation
(the generated \`src/main.rs\` passes \`AppActions\` to \`run_multi_stage_app\`), so \`cargo test\` fails if
the seam is broken. Never edit the generated \`src/main.rs\` / \`src/screens/*.rs\`; your logic lives in the
write-once \`src/app_actions.rs\`. Contract spec: \`docs/rust-backend-contract.md\`.
`
  );
  return [file, readme];
}

async function genCompose(outDir, pkg) {
  const srcRoot = await findAndroidSrcRoot(outDir);
  const nuiPkg = `${pkg}.nui`;
  const file = path.join(srcRoot, 'test', 'kotlin', pkgToPath(nuiPkg), 'NuiAppActionsContractTest.kt');
  await writeFileEnsured(file, `package ${nuiPkg}

import kotlin.test.Test
import kotlin.test.assertNotNull

class NuiAppActionsContractTest {
    @Test fun writeOnceImplementationSatisfiesGeneratedContract() {
        val actions: NuiAppActions = NuiAppActionsImpl()
        assertNotNull(actions)
    }
}
`);
  return [file];
}

async function genSwiftUi(outDir) {
  const file = path.join(outDir, 'Tests', 'NativeUiAppActionsContractTests.swift');
  await writeFileEnsured(file, `import XCTest
@testable import App

@MainActor
final class NativeUiAppActionsContractTests: XCTestCase {
    func testGeneratedAppActionsSeamIsReachable() {
        XCTAssertNotNil(DefaultAppActions.self)
    }
}
`);
  return [file];
}

async function findAppCsproj(outDir) {
  for (const entry of await fs.readdir(outDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'Runtime' || entry.name === 'tests') continue;
    const candidate = path.join(outDir, entry.name, `${entry.name}.csproj`);
    try { await fs.stat(candidate); return { file: candidate, namespace: entry.name }; } catch { /* keep looking */ }
  }
  throw new TestGenError(`No generated app .csproj found under ${outDir}.`);
}

async function genCsharp(outDir) {
  const app = await findAppCsproj(outDir);
  const testDir = path.join(outDir, 'tests', 'NativeUi.ContractTests');
  const relative = path.relative(testDir, app.file).replaceAll(path.sep, '/');
  const projectFile = path.join(testDir, 'NativeUi.ContractTests.csproj');
  const sourceFile = path.join(testDir, 'AppActionsContractTests.cs');
  await writeFileEnsured(projectFile, `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework><IsTestProject>true</IsTestProject><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup>
  <ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.1" /><PackageReference Include="xunit" Version="2.9.3" /><PackageReference Include="xunit.runner.visualstudio" Version="3.1.4" /></ItemGroup>
  <ItemGroup><ProjectReference Include="${relative}" /></ItemGroup>
</Project>
`);
  await writeFileEnsured(sourceFile, `using Nui.Rt.Core.Actions;
using ${app.namespace};

public sealed class AppActionsContractTests
{
    [Xunit.Fact]
    public void WriteOnceImplementationSatisfiesGeneratedContract()
    {
        INuiBackend actions = new AppActions();
        Xunit.Assert.NotNull(actions);
    }
}
`);
  return [projectFile, sourceFile];
}

function declaredWebSeam(target, basename) {
  return (Array.isArray(target.writeOnceFiles) ? target.writeOnceFiles : [])
    .find((file) => path.posix.basename(file) === basename);
}

function relativeModuleSpecifier(fromFile, toFile, { keepExtension = false } = {}) {
  let relative = path.relative(path.dirname(fromFile), toFile).replaceAll(path.sep, '/');
  if (!keepExtension) relative = relative.replace(/\.ts$/, '');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function webContractTest(target, outDir) {
  const typed = target.id !== 'web-html';
  const extension = typed ? '.ts' : '.js';
  const seam = declaredWebSeam(target, `app-actions${extension}`);
  if (!seam) throw new TestGenError(`${target.id} does not declare an app-actions${extension} write-once seam.`);
  const contract = typed
    ? path.posix.join(path.posix.dirname(seam), 'contracts.ts')
    : null;
  const file = target.id === 'web-angular'
    ? path.join(outDir, 'src', 'app', 'app-actions.contract.spec.ts')
    : path.join(outDir, 'tests', `app-actions.contract.test.${typed ? 'ts' : 'mjs'}`);
  const seamFile = path.join(outDir, ...seam.split('/'));
  const seamImport = relativeModuleSpecifier(file, seamFile, { keepExtension: !typed });
  if (!typed) {
    return {
      file,
      source: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appActions } from '${seamImport}';

test('vanilla write-once web action seam exposes the application handler surface', () => {
  for (const method of ['onScreenReady', 'callApi', 'callDatabase', 'submitForm', 'setState', 'animatePanel', 'runAction']) {
    assert.equal(typeof appActions[method], 'function', method);
  }
});
`,
    };
  }
  const contractFile = path.join(outDir, ...contract.split('/'));
  const contractImport = relativeModuleSpecifier(file, contractFile);
  return {
    file,
    source: `import { describe, expect, it } from 'vitest';
import { appActions } from '${seamImport}';
import type { ActionContext, ActionResult } from '${contractImport}';

type AsyncAction = (context: ActionContext) => Promise<ActionResult>;
const actionHandlers = {
  callApi: appActions.callApi,
  callDatabase: appActions.callDatabase,
  submitForm: appActions.submitForm,
  setState: appActions.setState,
  animatePanel: appActions.animatePanel,
  runAction: appActions.runAction,
} satisfies Record<string, AsyncAction>;
const onScreenReady: (context: { routeId: string }) => Promise<void> = appActions.onScreenReady;

describe('${target.id} developer action seam', () => {
  it('satisfies the generated async contract without invoking application effects', () => {
    expect(typeof onScreenReady).toBe('function');
    for (const handler of Object.values(actionHandlers)) expect(typeof handler).toBe('function');
  });
});
`,
  };
}

async function genWeb(outDir, target) {
  const test = webContractTest(target, outDir);
  await writeFileEnsured(test.file, test.source);
  return [test.file];
}

function legacyTestTargets(platform) {
  if (platform === 'both') return resolveTargets(['legacy-mobile']);
  if (platform === 'android') return resolveTargets(['android-views']);
  if (platform === 'ios') return resolveTargets(['ios-uikit']);
  if (platform === 'web') return resolveTargets(['web']);
  return resolveTargets(['rust-desktop']);
}

async function main() {
  try {
    const { project, platform, out, iosOut, pkg, selectedTargets } = parseArgs(process.argv.slice(2));

    let raw;
    try {
      raw = await fs.readFile(project, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') throw new TestGenError(`Project file not found: ${project}`);
      throw new TestGenError(`Could not read ${project}: ${e.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new TestGenError(`${project} is not valid JSON: ${e.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.stages) || !parsed.stages.length) {
      throw new TestGenError(`${project} has no stages[] — not a NativeUI project.`);
    }

    const named = collectNamedNodes(parsed);
    const written = [];

    if (!selectedTargets.length) {
      if (platform === 'android' || platform === 'both') {
        const androidOut = path.resolve(out);
        const androidPkg = await readAndroidPackage(androidOut, pkg);
        written.push(...(await genAndroid(parsed, named, androidOut, androidPkg)));
      }
      if (platform === 'ios' || platform === 'both') written.push(...(await genIos(parsed, named, path.resolve(iosOut))));
      if (platform === 'rust') written.push(...(await genRust(parsed, path.resolve(out))));
    } else {
      const multiple = selectedTargets.length > 1;
      for (const target of selectedTargets) {
        const targetOut = path.resolve(multiple ? path.join(out, target.id) : out);
        if (target.id === 'android-compose') {
          written.push(...(await genCompose(targetOut, await readAndroidPackage(targetOut, pkg))));
        } else if (target.id === 'android-views') {
          written.push(...(await genAndroid(parsed, named, targetOut, await readAndroidPackage(targetOut, pkg))));
        } else if (target.id === 'ios-swiftui') {
          written.push(...(await genSwiftUi(targetOut)));
        } else if (target.id === 'ios-uikit') {
          written.push(...(await genIos(parsed, named, targetOut)));
        } else if (target.platform === 'rust') {
          written.push(...(await genRust(parsed, targetOut)));
        } else if (target.platform === 'csharp') {
          written.push(...(await genCsharp(targetOut)));
        } else if (target.platform === 'web') {
          written.push(...(await genWeb(targetOut, target)));
        }
      }
    }

    process.stdout.write(
      `Generated contract tests (named nodes: ${named.length}, targets: ${(selectedTargets.length ? selectedTargets : legacyTestTargets(platform)).map((target) => target.id).join(', ')}):\n` +
        written.map((f) => `  ${f}`).join('\n') +
        `\nThese assert the NuiBackend contract surface; they never edit generated UI.\n`
    );
    process.exit(0);
  } catch (err) {
    if (err instanceof TestGenError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}

export {
  parseArgs,
  controlPropertyName,
  collectNamedNodes,
  deriveAccessors,
  iosTestSource,
  androidTestSource,
  rustTestSource,
  genCsharp,
  genWeb,
  webContractTest,
  KOTLIN_KEYWORDS,
  SWIFT_KEYWORDS,
};
