/** Read-only local parity audit against the backend's real public capability method. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as z from 'zod/v4';
import { microtransactionToolDefinitions } from '../dist/microtransactionTools.js';

const container = process.argv[2] || 'glitch_php';
if (!/^[A-Za-z0-9_.-]+$/.test(container)) throw new Error('Invalid container name');
const php = 'require "vendor/autoload.php"; $app=require "bootstrap/app.php"; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); echo json_encode(app(App\\Http\\Controllers\\McpMicrotransactionController::class)->operations());';
let operations;
try {
  operations = JSON.parse(execFileSync('docker', ['exec', '-w', '/code', container, 'php', '-r', php.replaceAll('\\\\', '\\')], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 }));
} catch {
  throw new Error('Could not read public backend commerce schemas. Start the local PHP container; no database mutation or provider payment is performed by this audit.');
}

const tools = new Map(microtransactionToolDefinitions.filter(tool => tool.description.includes('/operations/')).map(tool => [tool.description.match(/\/operations\/([a-z.]+);/)[1], tool]));
assert.deepEqual([...tools.keys()].sort(), operations.map(operation => operation.operation).sort(), 'Every backend MCP operation needs an explicit tool');

function nonNull(schema) {
  if (!schema) return schema;
  return schema.anyOf?.find(item => item.type !== 'null') || schema;
}
function compare(server, local, path) {
  local = nonNull(local);
  assert(local, `Missing local schema ${path}`);
  for (const key of ['enum', 'minItems', 'maxItems', 'minimum', 'maximum', 'maxLength', 'format']) {
    if (server[key] !== undefined) assert.deepEqual(local[key], server[key], `${path}.${key}`);
  }
  if (server.properties) {
    assert.deepEqual(Object.keys(local.properties || {}).sort(), Object.keys(server.properties).sort(), `${path} property names`);
    for (const [key, value] of Object.entries(server.properties)) compare(value, local.properties[key], `${path}.${key}`);
  }
  if (server.items) compare(server.items, local.items, `${path}[]`);
  if (server.additionalProperties && typeof server.additionalProperties === 'object') compare(server.additionalProperties, local.additionalProperties, `${path}.*`);
}

for (const operation of operations) {
  const tool = tools.get(operation.operation);
  const local = z.toJSONSchema(tool.validationSchema, { io: 'input', unrepresentable: 'any' });
  delete local.properties.title_id;
  delete local.properties.confirm;
  local.required = (local.required || []).filter(key => key !== 'title_id' && key !== 'confirm');
  assert.deepEqual(local.required.sort(), operation.input_schema.required.slice().sort(), `${operation.operation} required fields`);
  assert.equal(tool.readOnlyHint, !operation.requires_confirmation, `${operation.operation} confirmation`);
  assert(tool.description.includes(operation.ability), `${operation.operation} ability must be documented exactly`);
  compare(operation.input_schema, local, operation.operation);
}
console.log(`Commerce schema parity passed: ${operations.length} real backend operations; argument names, required fields, nested enums/limits/formats, abilities and confirmation flags.`);
