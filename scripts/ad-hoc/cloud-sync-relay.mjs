#!/usr/bin/env node
/**
 * cloud-sync-relay.mjs — minimal self-hosted OmniRoute Remote Settings Sync relay.
 *
 * Implements the exact contract expected by src/lib/cloudSync.ts and
 * src/app/api/sync/cloud/route.ts:
 *
 *   POST   /sync/:machineId        — store the config bundle, reply JSON (+ X-Cloud-Sig)
 *   GET    /:machineId/v1/verify   — 200 when Bearer key matches a synced apiKeys[].key
 *   DELETE /sync/:machineId        — drop the stored bundle
 *
 * Zero dependencies. Node >= 22.
 *
 * Env:
 *   PORT                          default 8787
 *   HOST                          default 127.0.0.1 (set 0.0.0.0 behind a tunnel/proxy)
 *   RELAY_DATA_DIR                default ~/.omniroute-cloud-relay
 *   OMNIROUTE_CLOUD_SYNC_SECRET   when set, every response body is signed with
 *                                 HMAC-SHA256 in the X-Cloud-Sig header (use the
 *                                 same value in the OmniRoute .env)
 *
 * Run:  node scripts/ad-hoc/cloud-sync-relay.mjs
 */

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = process.env.RELAY_DATA_DIR || path.join(os.homedir(), ".omniroute-cloud-relay");
const SECRET = process.env.OMNIROUTE_CLOUD_SYNC_SECRET || "";
const MAX_BODY_BYTES = 10 * 1024 * 1024;

// machineId becomes a filename — allow only safe characters, no traversal.
const MACHINE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function bundlePath(machineId) {
  return path.join(DATA_DIR, `${machineId}.json`);
}

function sign(rawBody) {
  return crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
}

function sendJson(res, status, payload) {
  const rawBody = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json" };
  if (SECRET) headers["X-Cloud-Sig"] = sign(rawBody);
  res.writeHead(status, headers);
  res.end(rawBody);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function timingSafeEqualStr(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

async function loadBundle(machineId) {
  try {
    return JSON.parse(await fs.readFile(bundlePath(machineId), "utf8"));
  } catch {
    return null;
  }
}

async function handleSync(machineId, req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return sendJson(res, 400, { error: "Invalid payload" });
  }

  const stored = { ...body, _storedAt: new Date().toISOString() };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(bundlePath(machineId), JSON.stringify(stored, null, 2), "utf8");

  // Echo providers keyed by id — the client only applies entries whose
  // updatedAt is newer than its local copy, so this is a safe no-op merge.
  const providersById = {};
  for (const provider of Array.isArray(body.providers) ? body.providers : []) {
    if (provider && typeof provider === "object" && provider.id) {
      providersById[provider.id] = provider;
    }
  }

  return sendJson(res, 200, {
    success: true,
    changes: { storedAt: stored._storedAt, version: body.version || null },
    data: { providers: providersById },
  });
}

async function handleVerify(machineId, req, res) {
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return sendJson(res, 401, { error: "Missing bearer token" });

  const bundle = await loadBundle(machineId);
  const apiKeys = Array.isArray(bundle?.apiKeys) ? bundle.apiKeys : [];
  const known = apiKeys.some((entry) => entry?.key && timingSafeEqualStr(entry.key, bearer));
  if (!known) return sendJson(res, 401, { error: "Unknown machine or key" });

  return sendJson(res, 200, { ok: true, machineId, verifiedAt: new Date().toISOString() });
}

async function handleDelete(machineId, res) {
  await fs.rm(bundlePath(machineId), { force: true });
  return sendJson(res, 200, { success: true });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const segments = url.pathname.split("/").filter(Boolean);

    // POST|DELETE /sync/:machineId
    if (segments.length === 2 && segments[0] === "sync" && MACHINE_ID_RE.test(segments[1])) {
      if (req.method === "POST") return await handleSync(segments[1], req, res);
      if (req.method === "DELETE") return await handleDelete(segments[1], res);
    }

    // GET /:machineId/v1/verify
    if (
      req.method === "GET" &&
      segments.length === 3 &&
      segments[1] === "v1" &&
      segments[2] === "verify" &&
      MACHINE_ID_RE.test(segments[0])
    ) {
      return await handleVerify(segments[0], req, res);
    }

    if (req.method === "GET" && url.pathname === "/") {
      return sendJson(res, 200, { service: "omniroute-cloud-sync-relay", signed: Boolean(SECRET) });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const status = error?.message === "payload too large" ? 413 : 500;
    // Never leak stack traces or internal error details.
    return sendJson(res, status, {
      error: status === 413 ? "Payload too large" : "Internal error",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[cloud-sync-relay] listening on http://${HOST}:${PORT}`);
  console.log(`[cloud-sync-relay] data dir: ${DATA_DIR}`);
  console.log(
    `[cloud-sync-relay] response signing (X-Cloud-Sig): ${SECRET ? "ON" : "OFF (set OMNIROUTE_CLOUD_SYNC_SECRET)"}`
  );
});
