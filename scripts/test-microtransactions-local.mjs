/** Run only after the backend test owner releases the isolated database lease.
 * Reads a caller-owned 0600 fixture into child memory; never prints its contents,
 * exports tokens to the caller's shell, changes credentials, or deletes fixtures.
 */
import { constants, openSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

try {
  const fixturePath = process.argv[2];
  if (process.argv.length !== 3 || !fixturePath || !isAbsolute(fixturePath)) throw new Error('Provide the absolute path to the private isolated fixture; confirm the backend DB lease first.');
  let descriptor;
  let fixture;
  try {
    descriptor = openSync(fixturePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > 65536 || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) {
      throw new Error('Fixture must be a caller-owned private regular file, maximum 64 KiB.');
    }
    fixture = readFileSync(descriptor, 'utf8');
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
  // Payload validation, exact loopback/DB checks, and secret-safe errors are in
  // the opt-in test. Nothing in this launcher creates test financial fixtures.
  const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'test/microtransactions.local.e2e.test.ts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit',
    env: { ...process.env, GLITCH_COMMERCE_LOCAL_E2E: '1', GLITCH_COMMERCE_E2E_FIXTURE_JSON: fixture },
  });
  fixture = undefined;
  child.on('error', () => { console.error('Unable to start isolated commerce E2E; private fixture contents withheld.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch {
  console.error('Cannot open a private caller-owned fixture. Use an absolute 0600 regular-file path after coordinating the isolated backend DB window; contents withheld.');
  process.exitCode = 1;
}
