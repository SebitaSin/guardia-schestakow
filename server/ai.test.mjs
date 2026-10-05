import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { aiReady, analyzeBoardImage } from "./ai.mjs";

const config = { enabled: true, allowClinicalData: true, apiKey: "test", model: "model-test", budgetUsd: 1, callLimit: 2, inputRate: 1, outputRate: 2 };

test("AI is fail-closed until every budget and privacy control is configured", () => {
  assert.equal(aiReady({ ...config, allowClinicalData: false }), false);
  assert.equal(aiReady({ ...config, budgetUsd: 0 }), false);
  assert.equal(aiReady(config), true);
});

test("board analysis is structured, cached and charged once per image hash", async () => {
  const root = mkdtempSync(join(tmpdir(), "sch-ai-test-"));
  const imagePath = join(root, "board.jpg");
  mkdirSync(join(root, "ai"));
  writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  let calls = 0;
  const fetchImpl = async (_url, request) => {
    calls += 1;
    const sent = JSON.parse(request.body);
    assert.equal(sent.store, false);
    assert.equal(sent.reasoning.effort, "low");
    assert.equal(sent.text.format.type, "json_schema");
    return new Response(JSON.stringify({
      output: [{ content: [{ type: "output_text", text: JSON.stringify({ rows: [], general_observations: null }) }] }],
      usage: { input_tokens: 100, output_tokens: 20 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const [first, second] = await Promise.all([
      analyzeBoardImage({ imagePath, sourceHash: "abc", dataDir: root, config, fetchImpl }),
      analyzeBoardImage({ imagePath, sourceHash: "abc", dataDir: root, config, fetchImpl }),
    ]);
    assert.equal(first.status, "A_CONFIRMAR");
    assert.equal(second.cached, true);
    assert.equal(calls, 1);
  } finally {
    assert.ok(root.startsWith(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  }
});
