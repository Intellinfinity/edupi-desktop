import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { handleCatalogLine, readCatalogLines } from "./open-connector-catalog-host.mjs";

function runtime() {
  const calls = [];
  return {
    calls,
    async fetch(request) {
      calls.push({ method: request.method, url: request.url });
      return new Response(JSON.stringify({ success: true, data: [{ id: "gmail.search_messages" }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    },
  };
}

test("catalog host serves only local GET discovery requests", async () => {
  const connector = runtime();
  const providers = await handleCatalogLine(connector, JSON.stringify({ id: "one", op: "providers" }));
  const actions = await handleCatalogLine(connector, JSON.stringify({ id: "list", op: "actions", service: "gmail" }));
  const search = await handleCatalogLine(connector, JSON.stringify({ id: "two", op: "search", query: "lesson plan" }));
  const scopedSearch = await handleCatalogLine(connector, JSON.stringify({ id: "scope", op: "search", query: "meeting", service: "gmail" }));
  const inspect = await handleCatalogLine(connector, JSON.stringify({ id: "three", op: "inspect", actionId: "gmail.search_messages" }));
  assert.equal(providers.ok, true);
  assert.equal(actions.ok, true);
  assert.equal(search.ok, true);
  assert.equal(scopedSearch.ok, true);
  assert.equal(inspect.ok, true);
  assert.deepEqual(connector.calls, [
    { method: "GET", url: "http://127.0.0.1:32999/v1/providers" },
    { method: "GET", url: "http://127.0.0.1:32999/v1/actions?service=gmail" },
    { method: "GET", url: "http://127.0.0.1:32999/v1/actions/search?query=lesson+plan" },
    { method: "GET", url: "http://127.0.0.1:32999/v1/actions/search?query=meeting&service=gmail" },
    { method: "GET", url: "http://127.0.0.1:32999/v1/actions/gmail.search_messages" },
  ]);
});

test("catalog host rejects Action execution, admin paths and unexpected fields without calling runtime", async () => {
  const connector = runtime();
  for (const request of [
    { id: "one", op: "execute", actionId: "gmail.send_message", input: {} },
    { id: "two", op: "inspect", actionId: "/api/connections" },
    { id: "three", op: "providers", token: "hidden" },
    { id: "list", op: "actions", service: "../api/connections" },
    { id: "four", op: "search", query: "x".repeat(201) },
    { id: 123, op: "providers" },
  ]) {
    const result = await handleCatalogLine(connector, JSON.stringify(request));
    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid_catalog_request");
  }
  assert.equal(connector.calls.length, 0);
});

test("catalog host bounds input and output frames", async () => {
  const connector = runtime();
  assert.equal((await handleCatalogLine(connector, "x".repeat(8193))).code, "invalid_catalog_request");
  connector.fetch = async () => new Response(JSON.stringify({ success: true, data: "x".repeat(512 * 1024) }));
  assert.equal((await handleCatalogLine(connector, JSON.stringify({ id: "one", op: "providers" }))).code, "catalog_response_too_large");
});

test("stream reader discards oversized lines before buffering the next request", async () => {
  const valid = JSON.stringify({ id: "next", op: "providers" });
  const frames = [];
  for await (const frame of readCatalogLines(Readable.from([Buffer.alloc(256 * 1024, 120), Buffer.from("\n" + valid + "\n")]))) {
    frames.push(frame);
  }
  assert.deepEqual(frames, [null, valid]);
});

test("catalog host times out a hung runtime request", async () => {
  const connector = { fetch(request) {
    assert.ok(request.signal);
    return new Promise(() => {});
  } };
  const result = await handleCatalogLine(connector, JSON.stringify({ id: "slow", op: "providers" }), { timeoutMs: 20 });
  assert.deepEqual(result, { id: "slow", ok: false, code: "catalog_unavailable" });
});
