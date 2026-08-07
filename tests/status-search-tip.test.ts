import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { createAcpExtension } from "../src/index.js";

const STATE_FILE = "/tmp/pai-acp-status-tip.session.json";

function captureApi() {
  const handlers = new Map<string, ((event: any, ctx: any) => any)[]>();
  const api = {
    on(event: string, handler: (e: any, ctx: any) => any) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    tools: [] as any[],
    commands: new Map<string, any>(),
    registerTool(tool: any) { this.tools.push(tool); },
    registerCommand(name: string, options: any) { this.commands.set(name, options); },
  };
  return { api, handlers };
}

function userMsg(id: string, text: string) {
  return { type: "message", id, parentId: null, timestamp: "", message: { role: "user", content: text, timestamp: Date.now() } };
}

async function cleanState() {
  await rm(`${STATE_FILE}.acp.json`, { force: true });
}

function fakeCtx(entries: any[]) {
  return {
    mode: "rpc",
    hasUI: false,
    ui: { notify: () => {}, confirm: async () => true, select: async () => undefined, input: async () => "", setStatus: () => {} },
    model: { contextWindow: 200_000 },
    sessionManager: {
      buildContextEntries: () => entries,
      getSessionId: () => "test-session",
      getSessionFile: () => STATE_FILE,
    },
  };
}

const filler = (n: string) => `filler ${n} `.repeat(1500);

async function setup(entries: any[]) {
  const { api, handlers } = captureApi();
  createAcpExtension({ modelContextLimit: 200_000 })(api as any);
  const ctx = fakeCtx(entries);
  await handlers.get("context")![0]!({ type: "context", messages: [] }, ctx);
  const compressTool = api.tools.find((t: any) => t.name === "compress")!;
  const statusTool = api.tools.find((t: any) => t.name === "acp_status")!;
  return { compressTool, statusTool, ctx };
}

test("acp_status: < 2 active blocks → no search tip", async () => {
  await cleanState();
  const entries = [
    userMsg("e1", filler("one")),
    userMsg("e2", filler("two")),
    userMsg("e3", filler("three")),
  ];
  const { statusTool, ctx } = await setup(entries);
  const res = await statusTool.execute("sc1", {}, undefined, undefined, ctx);
  const text = (res.content[0] as any).text as string;
  assert.ok(!text.includes("search_context"), "should NOT show search tip with < 2 blocks");
});

test("acp_status: ≥ 2 active blocks → shows search tip", async () => {
  await cleanState();
  const entries = Array.from({ length: 30 }, (_, i) =>
    userMsg(`e${i + 1}`, filler(`msg${i + 1}`)),
  );
  const { compressTool, statusTool, ctx } = await setup(entries);

  // Compress two separate ranges to create 2 active blocks
  // Protected zone = last 5 messages, so compress early ranges
  await compressTool.execute(
    "tc1",
    { content: [{ startId: "m00001", endId: "m00010", summary: "This is a comprehensive summary of the first ten messages in the session covering initial setup and configuration steps." }] },
    undefined, undefined, ctx,
  );
  await compressTool.execute(
    "tc2",
    { content: [{ startId: "m00011", endId: "m00020", summary: "This is a detailed summary of messages eleven through twenty covering the middle portion of the discussion." }] },
    undefined, undefined, ctx,
  );

  const res = await statusTool.execute("sc2", {}, undefined, undefined, ctx);
  const text = (res.content[0] as any).text as string;
  assert.ok(text.includes("search_context"), "should show search tip with ≥ 2 blocks");
  assert.match(text, /Tip: \d+ compressed block\(s\)/, "tip should mention block count");
});
