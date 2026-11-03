import assert from "node:assert/strict";
import test from "node:test";
import { handleResetRequest } from "../src/lib/reset-handler";

function request(body: string, headers: HeadersInit = { "Content-Type": "application/json" }) {
  return new Request("http://localhost/api/documents", { method: "DELETE", headers, body });
}

test("reset handler refuses malformed or unconfirmed requests", async () => {
  let resetCalled = false;
  const reset = async () => { resetCalled = true; };

  const malformed = await handleResetRequest(request("{"), reset);
  assert.equal(malformed.status, 400);
  const unconfirmed = await handleResetRequest(request(JSON.stringify({ confirm: false })), reset);
  assert.equal(unconfirmed.status, 400);
  assert.equal(resetCalled, false);
});

test("reset handler runs the reset only after explicit confirmation", async () => {
  let resetCalls = 0;
  const response = await handleResetRequest(
    request(JSON.stringify({ confirm: true })),
    async () => { resetCalls += 1; },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reset: true });
  assert.equal(resetCalls, 1);
});

test("reset handler returns a safe error when Qdrant reset fails", async () => {
  const response = await handleResetRequest(
    request(JSON.stringify({ confirm: true })),
    async () => { throw new Error("private Qdrant endpoint details"); },
  );

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /Could not reset/);
  assert.doesNotMatch(JSON.stringify(body), /private Qdrant/);
});
