import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { showOpenConnectorConsole } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./desktop-native.ts");

test("native Console command rejects unbounded ports and is unavailable in a normal browser", async () => {
  for (const port of [0, -1, 65_536, 4.5, Number.NaN]) {
    await assert.rejects(showOpenConnectorConsole(port), /invalid_console_port/u);
  }
  await assert.rejects(showOpenConnectorConsole(32_999), /desktop_only/u);
});
