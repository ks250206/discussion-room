import { expect, test } from "vite-plus/test";
import { outputLimit, validateOutput } from "./protocol.ts";

test("accepts a complete result at the limit and explicitly rejects oversized output", () => {
  const output = "x".repeat(outputLimit);
  expect(validateOutput(output)).toEqual({ ok: true, value: output });
  const oversized = validateOutput(`${output}x`);
  expect(oversized).toEqual({
    ok: false,
    error: `Output exceeds ${outputLimit} characters; no partial result returned`,
  });
  expect(oversized).not.toHaveProperty("value");
});
