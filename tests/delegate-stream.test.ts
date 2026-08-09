import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStreamedFile, prefixStderrChunk } from "../src/delegate-tool.js";

// ─── prefixStderrChunk: streamed stderr must stay distinguishable ──────────

test("prefixStderrChunk prefixes [stderr] to every chunk", () => {
  const out = prefixStderrChunk(Buffer.from("warn: something\n")).toString("utf8");
  assert.equal(out, "[stderr] warn: something\n");
});

test("prefixStderrChunk handles empty chunks without throwing", () => {
  const out = prefixStderrChunk(Buffer.alloc(0)).toString("utf8");
  assert.equal(out, "[stderr] ");
});

// ─── ensureStreamedFile: finalize semantics for the live-streamed file ─────

test("ensureStreamedFile leaves a non-empty file untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "acp-stream-test-"));
  const file = join(dir, "a.out");
  await writeFile(file, "some output\n", "utf8");
  assert.equal(await ensureStreamedFile(file), file);
  assert.equal(await readFile(file, "utf8"), "some output\n");
  await rm(dir, { recursive: true, force: true });
});

test("ensureStreamedFile pads an empty file with (no output)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "acp-stream-test-"));
  const file = join(dir, "empty.out");
  await writeFile(file, "", "utf8");
  assert.equal(await ensureStreamedFile(file), file);
  assert.equal(await readFile(file, "utf8"), "(no output)");
  await rm(dir, { recursive: true, force: true });
});

test("ensureStreamedFile returns empty string for a missing file (caller falls back)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "acp-stream-test-"));
  const file = join(dir, "missing.out");
  assert.equal(await ensureStreamedFile(file), "");
  await rm(dir, { recursive: true, force: true });
});
