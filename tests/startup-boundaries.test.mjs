import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runLocalUrl = new URL("../scripts/run-local.mjs", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

test("normal dashboard startup leaves local MCP testing opt-in", async () => {
  const [runLocalSource, packageSource] = await Promise.all([
    readFile(runLocalUrl, "utf8"),
    readFile(packageUrl, "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.doesNotMatch(runLocalSource, /scripts\/dashboard-mcp\.ts/);
  assert.equal(
    packageJson.scripts.mcp,
    "node --import tsx scripts/dashboard-mcp.ts",
  );
});
