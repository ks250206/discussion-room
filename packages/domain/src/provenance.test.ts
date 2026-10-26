import { assert, describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  ok,
  ProvenanceSchema,
  validate,
  type Id,
  type Provenance,
  type Timestamp,
} from "./index.ts";

const provenanceId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const sourceId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const fields = {
  id: provenanceId,
  sourceIds: [sourceId],
  createdBy: "researcher-1",
  method: "EIS fit using recorded settings",
  timestamp: "2026-10-26T23:45:01.0012300+09:00",
};

describe("Provenance", () => {
  test.each(["measurement", "literature", "calculation", "manual"])(
    "retains local origin category %s and source/author/time metadata",
    (originType) => {
      const input = Object.freeze({ ...fields, sourceIds: Object.freeze([sourceId]), originType });
      const result = validate(ProvenanceSchema, input);
      expect(result).toEqual(ok(input));
      assert(result.ok);
      expectTypeOf(result.value).toExtend<Provenance>();
      expectTypeOf(result.value.id).toEqualTypeOf<Id>();
      expectTypeOf(result.value.sourceIds).toEqualTypeOf<readonly Id[]>();
      expectTypeOf(result.value.timestamp).toEqualTypeOf<Timestamp>();
    },
  );

  test("permits explicitly empty source references without synthesizing sources", () => {
    const input = { ...fields, sourceIds: [], originType: "manual" };
    expect(validate(ProvenanceSchema, input)).toEqual(ok(input));
  });

  test("retains AI model and exact generation time independently of human approval", () => {
    const input = {
      ...fields,
      createdBy: "agent-1",
      originType: "ai",
      generatedBy: "ai",
      modelId: "provider/model-version",
    };
    const result = validate(ProvenanceSchema, input);
    expect(result).toEqual(ok(input));
    assert(result.ok && result.value.originType === "ai");
    const provenance: Provenance = result.value;
    expect(provenance.generatedBy).toBe("ai");
    expect(provenance.modelId).toBe("provider/model-version");
    expect(provenance.timestamp).toBe(fields.timestamp);
  });

  test.each([
    { ...fields, originType: "unknown" },
    { ...fields, originType: "manual", id: "bad-id" },
    { ...fields, originType: "manual", sourceIds: ["bad-source-id"] },
    { ...fields, originType: "manual", sourceIds: undefined },
    { ...fields, originType: "manual", createdBy: " " },
    { ...fields, originType: "manual", method: "" },
    { ...fields, originType: "manual", timestamp: "2026-02-30T00:00:00Z" },
    { ...fields, originType: "manual", timestamp: undefined },
    { ...fields, originType: "manual", confidence: 0.9 },
    { ...fields, originType: "ai" },
    { ...fields, originType: "ai", generatedBy: "ai" },
    { ...fields, originType: "ai", generatedBy: "human", modelId: "model" },
    { ...fields, originType: "ai", generatedBy: "ai", modelId: " " },
    { ...fields, originType: "ai", generatedBy: "ai", modelId: undefined },
    { ...fields, originType: "manual", generatedBy: "ai", modelId: "model" },
  ])("rejects invalid or unmodeled provenance without dropping metadata %j", (input) => {
    expect(validate(ProvenanceSchema, Object.freeze(input)).ok).toBe(false);
  });

  test.each(["id", "originType", "sourceIds", "createdBy", "method", "timestamp"])(
    "requires %s instead of assigning a default",
    (field) => {
      const input: Record<string, unknown> = { ...fields, originType: "manual" };
      delete input[field];
      expect(validate(ProvenanceSchema, input).ok).toBe(false);
      expect(input).not.toHaveProperty(field);
    },
  );
});
