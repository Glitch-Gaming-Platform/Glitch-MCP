#!/usr/bin/env node
// Isolated end-to-end check of the public MCP transport. No account credentials used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

async function ephemeralPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}
async function main() {
  const seen = [];
  const upstream = createServer((req, res) => {
    seen.push({ path: req.url, authorization: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/mcp/v1/auth/status" &&
        ["Bearer test-user-one", "Bearer test-user-two"].includes(req.headers.authorization)) {
      res.end(JSON.stringify({ data: { authenticated: true } }));
      return;
    }
    res.statusCode = 401;
    res.end(JSON.stringify({ data: { authenticated: false } }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamPort = upstream.address().port;
  const port = await ephemeralPort();
  const child = spawn(process.execPath, ["dist/cli.js", "http", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: new URL("../", import.meta.url).pathname,
    env: {
      ...process.env,
      GLITCH_API_BASE_URL: `http://127.0.0.1:${upstreamPort}/api`,
      GLITCH_API_TOKEN: "",
      GLITCH_MCP_TOKEN: "",
      GLITCH_TITLE_ID: "",
      GLITCH_MCP_DEFAULT_TITLE_ID: "",
      GLITCH_MCP_ALLOW_LOCAL_FILE_READS: "false",
      GLITCH_MCP_OAUTH_ENABLED: "false",
      GLITCH_MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
      GLITCH_MCP_RATE_LIMIT_PER_MINUTE: "100"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let childOutput = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", chunk => { childOutput += chunk.toString().slice(0, 200); });
  }
  const url = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 70; attempt++) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(url + "/health");
        if (response.status === 200) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, "MCP gateway failed to become ready: " + childOutput);
    let response = await fetch(url + "/health");
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.oauth_enabled, false);
    assert.equal(health.status, "ok");

    response = await fetch(url + "/mcp");
    assert.equal(response.status, 405, "stateless MCP GET is explicitly unsupported");

    const init = {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gateway-smoke", version: "1.0.0" } }
    };
    const request = (authorization, body = init) => fetch(url + "/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(authorization ? { Authorization: authorization } : {})
      },
      body: JSON.stringify(body)
    });
    response = await request();
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate") || "", /Bearer/);
    assert.doesNotMatch(await response.text(), /test-user-one/);

    response = await request("Basic abc");
    assert.equal(response.status, 401);
    response = await request("Bearer revoked-token");
    assert.equal(response.status, 401);

    response = await request("Bearer test-user-one");
    assert.equal(response.status, 200, "valid MCP initialize should succeed");
    const initBody = await response.text();
    assert.match(initBody, /glitch-mcp/);
    assert.ok(!initBody.includes("test-user-one"), "token must never be reflected in MCP response");

    response = await request("Bearer test-user-two", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    assert.equal(response.status, 200, "tools/list should succeed for a second principal");
    const toolsBody = await response.text();
    assert.match(toolsBody, /glitch_auth_status/);

    response = await request("Bearer revoked-token", { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
    assert.equal(response.status, 401, "revoked principal must not enumerate tools");

    response = await fetch(url + "/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer test-user-one" },
      body: "{malformed"
    });
    assert.equal(response.status, 400, "invalid JSON must be rejected");

    assert.ok(seen.some(call => call.authorization === "Bearer test-user-one"));
    assert.ok(seen.some(call => call.authorization === "Bearer test-user-two"));
    assert.ok(seen.some(call => call.authorization === "Bearer revoked-token"));
    assert.ok(!seen.some(call => call.authorization === "Bearer undefined"));
    console.log("PASS: health, stateless transport, auth challenge, invalid/revoked credentials, two isolated users, tools/list, malformed JSON");
  } finally {
    child.kill("SIGTERM");
    upstream.close();
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 2000))]);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
