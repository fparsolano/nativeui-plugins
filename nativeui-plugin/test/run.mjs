// run.mjs — run the plugin self-test suite with node's built-in test runner.
//
//   node test/run.mjs        (or: npm test)
//
// Pure Node (node:test + node:assert), no external deps. Discovers every *.test.mjs
// in this directory and runs it in a child test process, exiting non-zero on failure.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tests = fs
  .readdirSync(here)
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => path.join(here, f))
  .sort();

if (!tests.length) {
  process.stderr.write('No *.test.mjs files found in test/.\n');
  process.exit(1);
}

const r = spawnSync('node', ['--test', ...tests], { stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
