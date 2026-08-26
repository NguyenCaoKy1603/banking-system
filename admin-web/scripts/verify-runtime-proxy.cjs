#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

const adminImage = process.env.ADMIN_WEB_IMAGE;
const fixtureImage = process.env.RUNTIME_PROXY_FIXTURE_IMAGE;
const clientHost = process.env.RUNTIME_PROXY_CLIENT_HOST || "admin.preview.example.test";
const runId = (process.env.GITHUB_RUN_ID || `${Date.now()}-${process.pid}`).replace(/[^a-zA-Z0-9-]/g, "-");

if (!adminImage || !fixtureImage) {
  console.error("ADMIN_WEB_IMAGE and RUNTIME_PROXY_FIXTURE_IMAGE are required");
  process.exit(2);
}

const names = {
  network: `admin-web-runtime-proxy-${runId}`,
  fixtureA: `admin-web-runtime-fixture-a-${runId}`,
  fixtureB: `admin-web-runtime-fixture-b-${runId}`,
  webA: `admin-web-runtime-web-a-${runId}`,
  webB: `admin-web-runtime-web-b-${runId}`,
};

function docker(args, options = {}) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
    timeout: options.timeout || 30_000,
  }).trim();
}

function dockerQuiet(args) {
  try {
    docker(args, { stdio: "ignore" });
  } catch {
    // Cleanup is best effort; preserve the original test failure.
  }
}

function fixtureScript() {
  return [
    "const http=require('http');",
    "const id=process.env.FIXTURE_ID;",
    "const expectedHost=process.env.EXPECTED_HOST;",
    "http.createServer((req,res)=>{",
    "  const host=req.headers.host||'';",
    "  const forwardedHost=req.headers['x-forwarded-host']||'';",
    "  if(host!==expectedHost){",
    "    res.writeHead(421,{'content-type':'application/json'});",
    "    res.end(JSON.stringify({error:'unexpected_host',expectedHost,host}));",
    "    return;",
    "  }",
    "  res.writeHead(200,{'content-type':'application/json','x-fixture-id':id});",
    "  res.end(JSON.stringify({status:'ok',fixture:id,host,forwardedHost,path:req.url}));",
    "}).listen(8081,'0.0.0.0');",
  ].join(" ");
}

function startFixture(name, id) {
  docker([
    "run",
    "-d",
    "--name",
    name,
    "--network",
    names.network,
    "-e",
    `FIXTURE_ID=${id}`,
    "-e",
    `EXPECTED_HOST=${name}:8081`,
    "--entrypoint",
    "node",
    fixtureImage,
    "-e",
    fixtureScript(),
  ]);
}

function startWeb(name, fixtureName) {
  docker([
    "run",
    "-d",
    "--name",
    name,
    "--network",
    names.network,
    "-e",
    "ADMIN_WEB_ENV=preview",
    "-e",
    `ADMIN_API_UPSTREAM=http://${fixtureName}:8081`,
    adminImage,
  ]);
}

function request(container, path) {
  return docker([
    "exec",
    container,
    "wget",
    "-qO-",
    "--header",
    `Host: ${clientHost}`,
    `http://127.0.0.1:8080${path}`,
  ]);
}

function assertProxyResponse(container, fixtureId, fixtureName, path) {
  const response = JSON.parse(request(container, path));
  assert.equal(response.status, "ok");
  assert.equal(response.fixture, fixtureId);
  assert.equal(response.host, `${fixtureName}:8081`);
  assert.equal(response.forwardedHost, clientHost);
  assert.equal(response.path, path);
}

function waitForReady(container) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      request(container, "/readyz");
      return;
    } catch (error) {
      lastError = error;
      dockerQuiet(["inspect", container]);
      const delay = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(delay, 0, 0, 1_000);
    }
  }
  throw lastError || new Error(`Timed out waiting for ${container}`);
}

function assertSameImageId() {
  const imageId = docker(["image", "inspect", adminImage, "--format", "{{.Id}}"]).trim();
  for (const container of [names.webA, names.webB]) {
    assert.equal(docker(["inspect", container, "--format", "{{.Image}}"]).trim(), imageId);
  }
}

function cleanup() {
  dockerQuiet(["rm", "-f", names.webA, names.webB, names.fixtureA, names.fixtureB]);
  dockerQuiet(["network", "rm", names.network]);
}

try {
  docker(["network", "create", names.network]);
  startFixture(names.fixtureA, "A");
  startFixture(names.fixtureB, "B");
  startWeb(names.webA, names.fixtureA);
  startWeb(names.webB, names.fixtureB);

  waitForReady(names.webA);
  waitForReady(names.webB);
  assertProxyResponse(names.webA, "A", names.fixtureA, "/readyz");
  assertProxyResponse(names.webA, "A", names.fixtureA, "/api/v1/admin/me");
  assertProxyResponse(names.webB, "B", names.fixtureB, "/readyz");
  assertProxyResponse(names.webB, "B", names.fixtureB, "/api/v1/admin/me");
  assertSameImageId();
  console.log(JSON.stringify({
    status: "pass",
    clientHost,
    adminImage,
    fixtureImage,
    checks: ["readyz", "api/v1/admin/me", "Host", "X-Forwarded-Host", "same-image-id"],
  }));
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  cleanup();
}
