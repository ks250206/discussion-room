import * as v from "valibot";
import { assert, describe, expect, expectTypeOf, test, vi } from "vite-plus/test";
import {
  createId,
  CURRENT_SCHEMA_VERSION,
  err,
  IdSchema,
  ok,
  SchemaVersionSchema,
  TimestampSchema,
  validate,
  type Id,
  type IdGenerator,
  type Result,
  type Timestamp,
} from "./index.ts";

const exampleId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("Result", () => {
  test("narrows success and expected failure by their discriminant", () => {
    const results: Result<number, { code: "missing" }>[] = [ok(3), err({ code: "missing" })];
    const messages = results.map((result) =>
      result.ok ? `value:${result.value}` : `error:${result.error.code}`,
    );
    expect(messages).toEqual(["value:3", "error:missing"]);
  });

  test("preserves falsy success values and the original error value", () => {
    const failure = { code: "invalid", details: ["missing field"] };
    expect(ok(undefined)).toEqual({ ok: true, value: undefined });
    expect(ok(0)).toEqual({ ok: true, value: 0 });
    expect(err(failure)).toEqual({ ok: false, error: failure });
    const result = err(failure);
    assert(!result.ok);
    expect(result.error).toBe(failure);
  });
});

describe("validation boundary", () => {
  test("excludes async schemas from the synchronous validation contract", () => {
    const schema = v.objectAsync({ title: v.string() });
    expectTypeOf<typeof schema>().not.toExtend<Parameters<typeof validate>[0]>();
  });

  test("infers the schema output, including explicit transformations", () => {
    const schema = v.pipe(
      v.string(),
      v.transform((input) => input.length),
    );
    const input: unknown = "research";
    const result = validate(schema, input);
    expect(result).toEqual(ok(8));
    assert(result.ok);
    expectTypeOf(result.value).toEqualTypeOf<number>();
  });

  test("retains all nested issue paths without throwing or changing the input", () => {
    const schema = v.object({ entries: v.array(v.object({ title: v.string() })) });
    const input = Object.freeze({
      entries: Object.freeze([Object.freeze({ title: 42 }), Object.freeze({ title: null })]),
    });
    const result = validate(schema, input);
    expect(result.ok).toBe(false);
    assert(!result.ok);
    expect(result.error.code).toBe("validation_failed");
    expect(result.error.issues).toHaveLength(2);
    expect(result.error.issues.map((issue) => v.getDotPath(issue))).toEqual([
      "entries.0.title",
      "entries.1.title",
    ]);
    expect(result.error.issues.map((issue) => issue.input)).toEqual([42, null]);
    expect(input.entries).toEqual([{ title: 42 }, { title: null }]);
  });

  test.each([undefined, null, 0, false, [], {}])(
    "rejects non-string boundary input %j",
    (input) => {
      expect(validate(v.string(), input).ok).toBe(false);
    },
  );
});

describe("ULID", () => {
  test("validates canonical IDs and brands the output", () => {
    const result = validate(IdSchema, exampleId);
    expect(result).toEqual(ok(exampleId));
    assert(result.ok);
    expectTypeOf(result.value).toEqualTypeOf<Id>();
    expectTypeOf<string>().not.toEqualTypeOf<Id>();
  });

  test("injects a deterministic generator, with no retained global state", () => {
    const generate = vi.fn<IdGenerator>(() => exampleId);
    expect(createId(generate)).toEqual(ok(exampleId));
    expect(createId(generate)).toEqual(ok(exampleId));
    expect(generate).toHaveBeenCalledTimes(2);
  });

  test("generates valid distinct IDs with the default secure generator", () => {
    const first = createId();
    const second = createId();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    assert(first.ok && second.ok);
    expect(validate(IdSchema, first.value).ok).toBe(true);
    expect(validate(IdSchema, second.value).ok).toBe(true);
    expect(first.value).not.toBe(second.value);
  });

  test.each([
    "",
    exampleId.toLowerCase(),
    ` ${exampleId}`,
    `${exampleId} `,
    exampleId.slice(1),
    `8${exampleId.slice(1)}`,
    `I${exampleId.slice(1)}`,
    `O${exampleId.slice(1)}`,
    `U${exampleId.slice(1)}`,
  ])("rejects malformed or noncanonical ID %j", (input) => {
    expect(validate(IdSchema, input).ok).toBe(false);
  });

  test("reports invalid injected output through Result", () => {
    const result = createId(() => "invalid");
    expect(result.ok).toBe(false);
    assert(!result.ok);
    expect(result.error.code).toBe("validation_failed");
  });

  test("does not disguise unexpected generator faults as validation failures", () => {
    const failure = new Error("entropy unavailable");
    expect(() =>
      createId(() => {
        throw failure;
      }),
    ).toThrow(failure);
  });
});

describe("ISO 8601 Timestamp", () => {
  test.each([
    "2026-10-26T23:45:01Z",
    "2026-10-26T23:45:01.0012300+09:00",
    "2026-10-26T00:00:00-05:30",
    "2000-02-29T12:00:00Z",
    "2024-02-29T12:00:00Z",
    "0000-02-29T00:00:00Z",
    "9999-12-31T23:59:59Z",
  ])("preserves the exact valid timestamp %s", (input) => {
    const result = validate(TimestampSchema, input);
    expect(result).toEqual(ok(input));
    assert(result.ok);
    expectTypeOf(result.value).toEqualTypeOf<Timestamp>();
    expectTypeOf<string>().not.toEqualTypeOf<Timestamp>();
  });

  test.each([
    "2026-02-29T00:00:00Z",
    "1900-02-29T00:00:00Z",
    "2024-02-30T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-06-31T00:00:00Z",
    "2026-09-31T00:00:00Z",
    "2026-11-31T00:00:00Z",
    "2026-00-01T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-00T00:00:00Z",
    "2026-01-32T00:00:00Z",
    "2026-10-26T24:00:00Z",
    "2026-10-26T23:60:00Z",
    "2026-10-26T23:59:60Z",
    "2026-10-26T23:59:59+24:00",
    "2026-10-26T23:59:59+09:60",
    "2026-10-26T23:59:59",
    "2026-10-26",
    "2026-10-26 23:59:59Z",
    "2026-10-26T23:59:59z",
    "2026-10-26T23:59:59+0900",
    "2026-10-26T23:59:59Z ",
    "2026-10-26T23:59:59.Z",
  ])("rejects unsupported or invalid timestamp %j", (input) => {
    expect(validate(TimestampSchema, input).ok).toBe(false);
  });
});

describe("schemaVersion", () => {
  const documentSchema = v.object({
    schemaVersion: SchemaVersionSchema,
    id: IdSchema,
    createdAt: TimestampSchema,
  });
  const documentFields = { id: exampleId, createdAt: "2026-10-26T00:00:00Z" };

  test("composes a required current-version field with the complete document schema", () => {
    const input = { schemaVersion: CURRENT_SCHEMA_VERSION, ...documentFields };
    const result = validate(documentSchema, input);
    expect(result).toEqual(ok(input));
    assert(result.ok);
    expectTypeOf(result.value.schemaVersion).toEqualTypeOf<1>();
  });

  test("rejects a missing version without silently defaulting or mutating the document", () => {
    const input = Object.freeze({ ...documentFields });
    expect(validate(documentSchema, input).ok).toBe(false);
    expect(input).not.toHaveProperty("schemaVersion");
  });

  test.each([undefined, null, "1", 0, 2, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects unsupported or non-numeric version %j",
    (schemaVersion) => {
      const result = validate(documentSchema, { schemaVersion, ...documentFields });
      expect(result.ok).toBe(false);
      assert(!result.ok);
      expect(result.error.issues.map((issue) => v.getDotPath(issue))).toContain("schemaVersion");
    },
  );
});
