/**
 * Regression test: Agent Deck must be detectable on /dashboard/cli-agents.
 *
 * Bug: "agent-deck" exists in the UI catalog (src/shared/constants/cliTools.ts)
 * but had no entry in the runtime detection registry (CLI_TOOLS in
 * src/shared/services/cliRuntime.ts), so getCliRuntimeStatus("agent-deck")
 * always returned { installed: false, reason: "unknown_tool" } and the
 * dashboard card showed "Not detected" even with the binary installed and
 * configured for OmniRoute.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Set DATA_DIR before importing modules that read it
process.env.DATA_DIR = path.join(os.tmpdir(), "omniroute-agent-deck-test");

const { CLI_TOOL_IDS, getCliConfigPaths, getCliRuntimeStatus } =
  await import("../../src/shared/services/cliRuntime.ts");
const { checkToolConfigStatus } = await import("../../src/lib/cliTools/checkToolConfigStatus.ts");

const tmpDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tmpDirs) {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// ── Runtime registry ──────────────────────────────────────────────────────────

test("agent-deck: is registered in the runtime detection catalog", () => {
  assert.ok(
    CLI_TOOL_IDS.includes("agent-deck"),
    "agent-deck is in the UI catalog (cliTools.ts) but missing from cliRuntime.ts CLI_TOOLS — detection always reports unknown_tool"
  );
});

test("agent-deck: resolves the upstream XDG config path (~/.config/agent-deck/config.toml)", () => {
  const paths = getCliConfigPaths("agent-deck");
  assert.ok(paths, "getCliConfigPaths('agent-deck') must not return null");
  const configPath = paths.config as string;
  assert.ok(
    configPath.endsWith(path.join(".config", "agent-deck", "config.toml")),
    `expected XDG config.toml path, got: ${configPath}`
  );
});

test("agent-deck: getCliRuntimeStatus detects a binary via CLI_AGENT_DECK_BIN override", async () => {
  const dir = await makeTempDir("omniroute-agent-deck-bin-");
  const binPath = path.join(dir, "agent-deck");
  const script =
    process.platform === "win32"
      ? "@echo off\r\necho Agent Deck v1.15.0\r\nexit 0\r\n"
      : "#!/bin/sh\necho 'Agent Deck v1.15.0'\nexit 0\n";
  fs.writeFileSync(binPath, script);
  if (process.platform !== "win32") fs.chmodSync(binPath, 0o755);

  const prev = process.env.CLI_AGENT_DECK_BIN;
  process.env.CLI_AGENT_DECK_BIN = binPath;
  try {
    const status = await getCliRuntimeStatus("agent-deck");
    assert.notEqual(status.reason, "unknown_tool", "agent-deck must not be an unknown tool");
    assert.equal(status.installed, true);
    assert.equal(status.runnable, true);
  } finally {
    if (prev === undefined) delete process.env.CLI_AGENT_DECK_BIN;
    else process.env.CLI_AGENT_DECK_BIN = prev;
  }
});

// ── Config status (TOML marker check) ─────────────────────────────────────────

test("agent-deck: returns 'configured' when config.toml references OmniRoute", async () => {
  const dir = await makeTempDir("omniroute-agent-deck-cfg-");
  const configPath = path.join(dir, "config.toml");
  await fsp.writeFile(
    configPath,
    `[tools.omniroute]\ncommand = "claude"\nenv = { ANTHROPIC_BASE_URL = "http://localhost:20128" }\n`,
    "utf-8"
  );
  assert.equal(await checkToolConfigStatus("agent-deck", configPath), "configured");
});

test("agent-deck: returns 'not_configured' when config.toml points elsewhere", async () => {
  const dir = await makeTempDir("omniroute-agent-deck-cfg-");
  const configPath = path.join(dir, "config.toml");
  await fsp.writeFile(
    configPath,
    `[claude]\nallow_dangerous_mode = false\n\n[tmux]\nsocket_name = "agent-deck"\n`,
    "utf-8"
  );
  assert.equal(await checkToolConfigStatus("agent-deck", configPath), "not_configured");
});
