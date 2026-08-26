import test from "node:test";
import assert from "node:assert/strict";

import { buildBasicAuthTrafficPolicy, parseBasicAuthPairs } from "../../src/lib/ngrokTunnel.ts";

test("parseBasicAuthPairs splits comma-separated user:pass pairs", () => {
  assert.deepEqual(parseBasicAuthPairs("user1:password123,user2:securepass456"), [
    "user1:password123",
    "user2:securepass456",
  ]);
});

test("parseBasicAuthPairs trims whitespace around pairs", () => {
  assert.deepEqual(parseBasicAuthPairs(" user1:pass1 , user2:pass2 "), [
    "user1:pass1",
    "user2:pass2",
  ]);
});

test("parseBasicAuthPairs returns empty array for unset or blank input", () => {
  assert.deepEqual(parseBasicAuthPairs(undefined), []);
  assert.deepEqual(parseBasicAuthPairs(null), []);
  assert.deepEqual(parseBasicAuthPairs(""), []);
  assert.deepEqual(parseBasicAuthPairs("   "), []);
});

test("parseBasicAuthPairs drops malformed entries without a user and password", () => {
  assert.deepEqual(parseBasicAuthPairs("nouserpass,valid:pair,:nopass,nouser:,other:ok"), [
    "valid:pair",
    "other:ok",
  ]);
});

test("parseBasicAuthPairs keeps passwords containing colons", () => {
  assert.deepEqual(parseBasicAuthPairs("user:pa:ss"), ["user:pa:ss"]);
});

test("buildBasicAuthTrafficPolicy returns null when no pairs given", () => {
  assert.equal(buildBasicAuthTrafficPolicy([]), null);
});

test("buildBasicAuthTrafficPolicy builds the on_http_request basic-auth policy", () => {
  const policy = buildBasicAuthTrafficPolicy(["user1:password123", "user2:securepass456"]);
  assert.ok(policy);
  assert.deepEqual(JSON.parse(policy as string), {
    on_http_request: [
      {
        actions: [
          {
            type: "basic-auth",
            config: {
              credentials: ["user1:password123", "user2:securepass456"],
            },
          },
        ],
      },
    ],
  });
});
