import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAndValidateJudgeResponse,
  validateJudgeObject,
} from "../src/llm/evidenceJudge.js";

test("parses sufficient evidence JSON", () => {
  const result = parseAndValidateJudgeResponse(
    '{"sufficient":true,"reason":"The passages directly support the answer.","missing":null}'
  );
  assert.equal(result.status, "sufficient");
  assert.equal(result.sufficient, true);
  assert.equal(result.missing, null);
});

test("normalizes insufficient evidence and fills missing reason", () => {
  const result = validateJudgeObject({
    sufficient: false,
    reason: "The passages discuss the topic but omit the requested date.",
  });
  assert.equal(result.status, "insufficient");
  assert.equal(result.sufficient, false);
  assert.equal(
    result.missing,
    "The passages discuss the topic but omit the requested date."
  );
});

test("rejects malformed evidence judge output", () => {
  assert.throws(
    () => validateJudgeObject({ sufficient: "unknown", reason: "Unclear" }),
    (error) => error.code === "MALFORMED_OUTPUT"
  );
});
