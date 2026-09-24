import { createInterface } from "node:readline";

process.stdout.write('{"type":"ready","version":1}\n');
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.query === "hang") {
    setInterval(() => {}, 1_000);
    await new Promise(() => {});
  }
  if (request.query === "crash") process.exit(9);
  if (request.query === "oversize") { process.stdout.write("x".repeat(600 * 1024)); continue; }
  const data = request.op === "search"
    ? [{ id: "test.lookup", service: "test", name: "lookup", description: process.env.EDUPI_OPENCONNECTOR_RUNTIME_TOKEN ? "LEAK" : "Safe" }]
    : { id: request.actionId, service: "test", name: "lookup", description: "Safe", inputSchema: { type: "object", properties: {}, required: [] } };
  process.stdout.write(JSON.stringify({ id: request.id, ok: true, data }) + "\n");
}
