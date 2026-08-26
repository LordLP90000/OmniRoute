import { describe, it, before } from "node:test";
import assert from "node:assert";
import * as toolDetector from "../../../src/lib/cli-helper/tool-detector.ts";
import { getCliToolCommandCandidates } from "../../../src/shared/services/cliRuntime.ts";

// Regression — agent-deck existed only in the UI catalog (cliTools.ts), not the
// runtime catalog (cliRuntime.ts). getCliToolCommandCandidates("agent-deck")
// returned [], so detectBinary() short-circuited and the dashboard permanently
// reported Agent Deck as not installed even when the binary was on PATH.
describe("tool-detector — agent-deck runtime catalog entry", () => {
  before(() => {
    // @ts-expect-error - internal test hook
    toolDetector.__setExecFileImpl(async (cmd) => {
      if (cmd === "agent-deck") {
        return { stdout: "v1.15.0\n" };
      }
      throw new Error("Command not found");
    });
  });

  it("resolves the agent-deck binary as a command candidate", () => {
    const candidates = getCliToolCommandCandidates("agent-deck");
    assert.ok(
      candidates.includes("agent-deck"),
      `expected 'agent-deck' in command candidates, got: ${JSON.stringify(candidates)}`
    );
  });

  it("detects an installed agent-deck binary with its config path", async () => {
    const result = await toolDetector.detectTool("agent-deck");
    assert.ok(result !== null, "detectTool('agent-deck') must not return null");
    assert.strictEqual(result!.id, "agent-deck");
    assert.strictEqual(result!.name, "Agent Deck");
    assert.strictEqual(result!.installed, true);
    assert.strictEqual(result!.version, "1.15.0");
    assert.ok(
      result!.configPath.includes(".config/agent-deck/config.toml"),
      `expected configPath to include '.config/agent-deck/config.toml', got: ${result!.configPath}`
    );
    assert.strictEqual(typeof result!.configured, "boolean");
  });
});
