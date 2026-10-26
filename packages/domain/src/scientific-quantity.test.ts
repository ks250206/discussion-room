import * as v from "valibot";
import { assert, describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  convertQuantity,
  divideFinite,
  err,
  ok,
  ScientificQuantitySchema,
  SUPPORTED_UNITS,
  validate,
  type ScientificQuantity,
} from "./index.ts";

const provenanceId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function quantity(input: unknown): ScientificQuantity {
  const result = validate(ScientificQuantitySchema, input);
  assert(result.ok);
  return result.value;
}

describe("ScientificQuantity boundary", () => {
  test("retains the complete supplied metadata without rounding or normalizing", () => {
    const input = Object.freeze({
      value: 1.23456789,
      unit: "angstrom",
      uncertainty: 0.001,
      uncertaintyType: "sd",
      significantFigures: 3,
      method: "  reported without rounding  ",
      provenanceId,
    });
    const result = validate(ScientificQuantitySchema, input);
    expect(result).toEqual(ok(input));
    assert(result.ok);
    expectTypeOf(result.value).toExtend<ScientificQuantity>();
  });

  test("preserves missing metadata, zero and signed zero", () => {
    expect(quantity({ value: 0, unit: "mS/cm" })).toEqual({ value: 0, unit: "mS/cm" });
    expect(Object.is(quantity({ value: -0, unit: "K" }).value, -0)).toBe(true);
    expect(quantity({ value: 1, unit: "m", uncertainty: 0 })).toEqual({
      value: 1,
      unit: "m",
      uncertainty: 0,
    });
  });

  test("retains an explicitly supplied unsupported unit without inventing its meaning", () => {
    expect(quantity({ value: -2, unit: "custom-unit" })).toEqual({
      value: -2,
      unit: "custom-unit",
    });
  });

  test.each([
    {},
    { unit: "m" },
    { value: null, unit: "m" },
    { value: undefined, unit: "m" },
    { value: "1", unit: "m" },
    { value: 1 },
    { value: 1, unit: "" },
    { value: 1, unit: " " },
    { value: 1, unit: " m" },
    { value: 1, unit: "m " },
    { value: Number.NaN, unit: "m" },
    { value: Number.POSITIVE_INFINITY, unit: "m" },
    { value: Number.NEGATIVE_INFINITY, unit: "m" },
    { value: 1, unit: "m", uncertainty: -1 },
    { value: 1, unit: "m", uncertainty: Number.NaN },
    { value: 1, unit: "m", uncertainty: Number.POSITIVE_INFINITY },
    { value: 1, unit: "m", uncertainty: null },
    { value: 1, unit: "m", uncertainty: undefined },
    { value: 1, unit: "m", uncertaintyType: "sd" },
    { value: 1, unit: "m", uncertainty: 1, uncertaintyType: "relative" },
    { value: 1, unit: "m", uncertainty: 1, uncertaintyType: undefined },
    { value: 1, unit: "m", significantFigures: 0 },
    { value: 1, unit: "m", significantFigures: -1 },
    { value: 1, unit: "m", significantFigures: 1.5 },
    { value: 1, unit: "m", significantFigures: Number.POSITIVE_INFINITY },
    { value: 1, unit: "m", significantFigures: Number.MAX_SAFE_INTEGER + 1 },
    { value: 1, unit: "m", significantFigures: undefined },
    { value: 1, unit: "m", method: "  " },
    { value: 1, unit: "m", method: undefined },
    { value: 1, unit: "m", provenanceId: "unvalidated-reference" },
    { value: 1, unit: "m", relativeUncertainty: true },
    { value: 1, unit: "m", temperatureKind: "difference" },
  ])("rejects invalid, missing or unsupported interpretation metadata %j", (input) => {
    const frozen = Object.freeze(input);
    const result = validate(ScientificQuantitySchema, frozen);
    expect(result.ok).toBe(false);
    expect(frozen).toEqual(input);
  });

  test("reports cross-field diagnostic paths", () => {
    const result = validate(ScientificQuantitySchema, {
      value: 10,
      unit: "m",
      uncertaintyType: "sd",
    });
    assert(!result.ok);
    expect(result.error.issues.map((issue) => v.getDotPath(issue))).toContain("uncertaintyType");
  });

  test.each(["sd", "se", "ci95", "instrument"])("retains uncertainty semantics %s", (type) => {
    expect(quantity({ value: 2, unit: "m", uncertainty: 1, uncertaintyType: type })).toEqual({
      value: 2,
      unit: "m",
      uncertainty: 1,
      uncertaintyType: type,
    });
  });
});

describe("explicit unit conversion", () => {
  test.each([
    [0, "°C", "K", 273.15],
    [273.15, "K", "°C", 0],
    [-273.15, "degC", "K", 0],
    [0, "K", "°C", -273.15],
    [100, "°C", "degC", 100],
    [25, "%", "fraction", 0.25],
    [0.25, "1", "percent", 25],
    [250, "percent", "1", 2.5],
    [-25, "%", "fraction", -0.25],
    [1, "m", "cm", 100],
    [1, "mm", "m", 0.001],
    [1, "µm", "nm", 1000],
    [1, "μm", "um", 1],
    [1, "angstrom", "Å", 1],
    [10, "Å", "nm", 1],
    [1, "mS/cm", "S/m", 0.1],
    [1, "S/cm", "mS/cm", 1000],
    [1, "MPa", "Pa", 1e6],
    [1000, "Pa", "kPa", 1],
  ])("converts %s %s explicitly to %s", (value, unit, toUnit, expected) => {
    const original = Object.freeze({ value, unit });
    const result = convertQuantity(original, toUnit, { temperatureKind: "absolute" });
    assert(result.ok);
    expect(result.value.value).toBe(expected);
    expect(result.value.unit).toBe(toUnit);
    expect(result.value).not.toHaveProperty("significantFigures");
    expect(result.value).not.toHaveProperty("uncertainty");
    expect(original).toEqual({ value, unit });
  });

  test.each([
    [-273.1500001, "°C"],
    [-273.1500001, "degC"],
    [-Number.MIN_VALUE, "K"],
  ])("rejects below-absolute-zero readings %s %s even before conversion", (value, unit) => {
    expect(validate(ScientificQuantitySchema, { value, unit }).ok).toBe(false);
    expect(convertQuantity({ value, unit }, "K").ok).toBe(false);
  });

  test("distinguishes percent from fraction at validation, without applying concentration bounds", () => {
    expect(quantity({ value: 150, unit: "%" })).toEqual({ value: 150, unit: "%" });
    expect(quantity({ value: -2, unit: "fraction" })).toEqual({ value: -2, unit: "fraction" });
    expect(convertQuantity({ value: 150, unit: "%" }, "1")).toEqual(ok({ value: 1.5, unit: "1" }));
  });

  test("converts temperature uncertainty without adding an offset and retains metadata", () => {
    const original = Object.freeze(
      quantity({
        value: 25,
        unit: "°C",
        uncertainty: 0.2,
        uncertaintyType: "instrument",
        method: "thermocouple",
        provenanceId,
      }),
    );
    expect(convertQuantity(original, "K", { temperatureKind: "absolute" })).toEqual(
      ok({ ...original, value: 298.15, unit: "K", uncertainty: 0.2 }),
    );
    expect(original.value).toBe(25);
    expect(original.unit).toBe("°C");
  });

  test("scales absolute uncertainty in both directions without guessing its type", () => {
    const original = quantity({ value: 25, unit: "%", uncertainty: 2, significantFigures: 3 });
    const result = convertQuantity(original, "fraction");
    expect(result).toEqual(
      ok({ value: 0.25, unit: "fraction", uncertainty: 0.02, significantFigures: 3 }),
    );
    assert(result.ok);
    expect(result.value).not.toHaveProperty("uncertaintyType");
    expect(convertQuantity(result.value, "%")).toEqual(ok(original));
  });

  test.each([
    [1, "µm", "nm", 0.5, 1000, 500],
    [10, "Å", "nm", 2.5, 1, 0.25],
    [25, "%", "fraction", 12.5, 0.25, 0.125],
    [1.25, "μm", "um", 0.125, 1.25, 0.125],
  ])(
    "avoids extra rounding in values and uncertainty for %s %s → %s",
    (value, unit, toUnit, uncertainty, expectedValue, expectedUncertainty) => {
      const original = quantity({
        value,
        unit,
        uncertainty,
        uncertaintyType: "sd",
        significantFigures: 3,
        method: "reported measurement",
        provenanceId,
      });
      const result = convertQuantity(original, toUnit);
      assert(result.ok);
      expect(result.value.value).toBe(expectedValue);
      expect(result.value.uncertainty).toBe(expectedUncertainty);
      expect(result.value).toEqual({
        ...original,
        value: expectedValue,
        uncertainty: expectedUncertainty,
        unit: toUnit,
      });
    },
  );

  test("preserves signed zero and exact value for identity and alias conversions", () => {
    const original = quantity({ value: -0, unit: "°C", significantFigures: 1 });
    expect(convertQuantity(original, "°C")).toEqual(ok(original));
    const alias = convertQuantity(original, "degC");
    assert(alias.ok);
    expect(Object.is(alias.value.value, -0)).toBe(true);
    expect(alias.value.unit).toBe("degC");
    expect(alias.value.significantFigures).toBe(1);
  });

  test.each([
    [25, "°C", "K", 2],
    [300, "K", "°C", 3],
    [300, "K", "degC", 3],
  ])(
    "rejects significant figures across an offset %s %s → %s",
    (value, unit, toUnit, significantFigures) => {
      const original = Object.freeze(
        quantity({
          value,
          unit,
          significantFigures,
          uncertainty: 0.2,
          uncertaintyType: "instrument",
          provenanceId,
        }),
      );
      const snapshot = { ...original };
      const options = Object.freeze({ temperatureKind: "absolute" } as const);
      expect(convertQuantity(original, toUnit, options)).toEqual(
        err({ code: "precision_not_transferable" }),
      );
      expect(original).toEqual(snapshot);
      expect(options).toEqual({ temperatureKind: "absolute" });
    },
  );

  test.each([
    [10, "K", "°C"],
    [10, "°C", "K"],
  ])("requires explicit absolute intent for %s %s → %s", (value, unit, toUnit) => {
    const original = Object.freeze({ value, unit });
    expect(convertQuantity(original, toUnit)).toEqual(
      err({ code: "absolute_temperature_required" }),
    );
    expect(convertQuantity(original, toUnit, {})).toEqual(
      err({ code: "absolute_temperature_required" }),
    );
    expect(original).toEqual({ value, unit });
  });

  test.each([
    null,
    false,
    "absolute",
    { temperatureKind: "difference" },
    { temperatureKind: undefined },
    { temperatureKind: "absolute", guessed: true },
  ])("validates external conversion options rather than dropping metadata %j", (options) => {
    const original = Object.freeze({ value: 10, unit: "K" });
    // @ts-expect-error Deliberately probe JavaScript callers with invalid boundary options.
    const result = convertQuantity(original, "°C", options);
    assert(!result.ok);
    expect(result.error.code).toBe("validation_failed");
    expect(original).toEqual({ value: 10, unit: "K" });
  });

  test.each([
    [298.15, "25"],
    [298.16, "25.010000000000048"],
  ])(
    "converts %s K without significant figures and preserves natural IEEE rounding",
    (value, expected) => {
      const original = Object.freeze(
        quantity({
          value,
          unit: "K",
          uncertainty: 0.2,
          uncertaintyType: "instrument",
          provenanceId,
        }),
      );
      const result = convertQuantity(original, "°C", { temperatureKind: "absolute" });
      assert(result.ok);
      expect(result.value).toEqual({ ...original, value: value - 273.15, unit: "°C" });
      expect(String(result.value.value)).toBe(expected);
      expect(result.value).not.toHaveProperty("significantFigures");
      expect(original.value).toBe(value);
      expect(original.unit).toBe("K");
    },
  );

  test("freezes all published unit metadata and aliases against runtime mutation", () => {
    const snapshot = SUPPORTED_UNITS.map((unit) => ({ ...unit, symbols: [...unit.symbols] }));
    expect(Object.isFrozen(SUPPORTED_UNITS)).toBe(true);
    expect(Reflect.set(SUPPORTED_UNITS, "0", null)).toBe(false);
    for (const unit of SUPPORTED_UNITS) {
      expect(Object.isFrozen(unit)).toBe(true);
      expect(Object.isFrozen(unit.symbols)).toBe(true);
      expect(Reflect.set(unit, "offset", 999)).toBe(false);
      expect(Reflect.set(unit.symbols, "0", "tampered")).toBe(false);
    }
    expect(SUPPORTED_UNITS).toEqual(snapshot);
    expect(convertQuantity({ value: 1, unit: "S/cm", significantFigures: 2 }, "mS/cm")).toEqual(
      ok({ value: 1000, unit: "mS/cm", significantFigures: 2 }),
    );
  });

  test("avoids an unnecessary overflowing base-unit intermediate", () => {
    expect(convertQuantity({ value: Number.MAX_VALUE, unit: "MPa" }, "MPa")).toEqual(
      ok({ value: Number.MAX_VALUE, unit: "MPa" }),
    );
  });

  test.each([
    ["°C", "%"],
    ["m", "S/m"],
    ["MPa", "K"],
  ])("rejects incompatible units %s → %s", (unit, toUnit) => {
    expect(convertQuantity({ value: 1, unit }, toUnit)).toEqual(
      err({ code: "incompatible_units", fromUnit: unit, toUnit }),
    );
  });

  test.each([
    ["C", "K", "C"],
    ["°F", "K", "°F"],
    ["K", "kelvin", "kelvin"],
    ["wt%", "fraction", "wt%"],
    ["ppm", "%", "ppm"],
    ["custom-unit", "custom-unit", "custom-unit"],
  ])("rejects unsupported units %s → %s", (unit, toUnit, unsupported) => {
    expect(convertQuantity({ value: 1, unit }, toUnit)).toEqual(
      err({ code: "unsupported_unit", unit: unsupported }),
    );
  });

  test.each([
    { value: Number.MAX_VALUE, unit: "m" },
    { value: 1, unit: "m", uncertainty: Number.MAX_VALUE },
  ])("rejects overflow in the converted value or uncertainty %j", (original) => {
    expect(convertQuantity(original, "angstrom")).toEqual(err({ code: "non_finite_result" }));
  });

  test.each([
    { value: Number.MIN_VALUE, unit: "angstrom" },
    { value: 1, unit: "angstrom", uncertainty: Number.MIN_VALUE },
  ])("rejects total underflow instead of replacing a nonzero value with zero %j", (original) => {
    expect(convertQuantity(original, "m")).toEqual(err({ code: "numeric_underflow" }));
  });

  test("revalidates nonfinite inputs and invalid target spelling", () => {
    const result = convertQuantity({ value: Number.POSITIVE_INFINITY, unit: "m" }, "cm");
    assert(!result.ok);
    expect(result.error.code).toBe("validation_failed");
    expect(convertQuantity({ value: 1, unit: "m" }, " cm").ok).toBe(false);
  });
});

describe("finite numeric division", () => {
  test.each([
    [6, 2, 3],
    [-1, 4, -0.25],
    [0, 2, 0],
    [Number.MIN_VALUE, 1, Number.MIN_VALUE],
    [Number.MAX_VALUE, Number.MAX_VALUE, 1],
  ])("divides finite scalar inputs %s / %s", (numerator, denominator, expected) => {
    expect(divideFinite(numerator, denominator)).toEqual(ok(expected));
  });

  test.each([0, -0])("rejects denominator %s", (denominator) => {
    expect(divideFinite(1, denominator)).toEqual(err({ code: "division_by_zero" }));
    expect(divideFinite(0, denominator)).toEqual(err({ code: "division_by_zero" }));
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects nonfinite operands %s through Result",
    (value) => {
      expect(divideFinite(value, 1).ok).toBe(false);
      expect(divideFinite(1, value).ok).toBe(false);
    },
  );

  test("rejects finite-input overflow and total underflow", () => {
    expect(divideFinite(Number.MAX_VALUE, 0.5)).toEqual(err({ code: "non_finite_result" }));
    expect(divideFinite(Number.MIN_VALUE, Number.MAX_VALUE)).toEqual(
      err({ code: "numeric_underflow" }),
    );
  });
});
