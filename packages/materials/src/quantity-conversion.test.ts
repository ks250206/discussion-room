import {
  convertQuantity,
  err,
  ok,
  ScientificQuantitySchema,
  SUPPORTED_UNITS,
  unitConversionRelation,
  validate,
  type ScientificQuantity,
} from "@discussion-room/domain";
import { assert, describe, expect, test } from "vite-plus/test";
import { convertQuantityWithFormula } from "./index.ts";

const provenanceId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function quantity(input: unknown): ScientificQuantity {
  const result = validate(ScientificQuantitySchema, input);
  assert(result.ok);
  return result.value;
}

/** Spec of the displayed affine formula. Identity is explicit; a zero offset is omitted. */
function expectedFormula(scaleExponent: number, offset: number): string {
  if (scaleExponent === 0 && offset === 0) return "y = x";
  const scaled = scaleExponent === 0 ? "x" : `x × 10^${String(scaleExponent)}`;
  if (offset === 0) return `y = ${scaled}`;
  const magnitude = String(offset < 0 ? -offset : offset);
  const sign = offset < 0 ? "-" : "+";
  return `y = ${scaled} ${sign} ${magnitude}`;
}

function applyAffine(value: number, scaleExponent: number, offset: number): number {
  const scaled = scaleExponent >= 0 ? value * 10 ** scaleExponent : value / 10 ** -scaleExponent;
  return offset === 0 ? scaled : scaled + offset;
}

describe("convertQuantityWithFormula", () => {
  test("converts area resistance by the exact 10000 factor and shows the formula", () => {
    const original = Object.freeze({ value: 1, unit: "Ω·m²" });
    const result = convertQuantityWithFormula(original, "Ω·cm²");
    expect(result).toEqual(
      ok({
        quantity: { value: 10000, unit: "Ω·cm²" },
        conversion: {
          fromUnit: "Ω·m²",
          toUnit: "Ω·cm²",
          scaleExponent: 4,
          offset: 0,
          formula: "y = x × 10^4",
        },
      }),
    );
    expect(original).toEqual({ value: 1, unit: "Ω·m²" });
    expect(convertQuantityWithFormula({ value: 1, unit: "ohm*m^2" }, "ohm*cm^2")).toEqual(
      ok({
        quantity: { value: 10000, unit: "ohm*cm^2" },
        conversion: {
          fromUnit: "ohm*m^2",
          toUnit: "ohm*cm^2",
          scaleExponent: 4,
          offset: 0,
          formula: "y = x × 10^4",
        },
      }),
    );
  });

  test("converts 1 mA/cm² to 10 A/m² without inferring geometry", () => {
    expect(convertQuantityWithFormula({ value: 1, unit: "mA/cm²" }, "A/m²")).toEqual(
      ok({
        quantity: { value: 10, unit: "A/m²" },
        conversion: {
          fromUnit: "mA/cm²",
          toUnit: "A/m²",
          scaleExponent: 1,
          offset: 0,
          formula: "y = x × 10^1",
        },
      }),
    );
    expect(convertQuantityWithFormula({ value: 1, unit: "mA/cm^2" }, "A/m^2")).toEqual(
      ok({
        quantity: { value: 10, unit: "A/m^2" },
        conversion: {
          fromUnit: "mA/cm^2",
          toUnit: "A/m^2",
          scaleExponent: 1,
          offset: 0,
          formula: "y = x × 10^1",
        },
      }),
    );
  });

  test.each([
    [-2, "Ω·cm²", "Ω·m²", -0.0002, -4, "y = x × 10^-4"],
    [-1, "A/cm²", "µA/cm²", -1e6, 6, "y = x × 10^6"],
    [-4, "uA/cm^2", "mA/cm^2", -0.004, -3, "y = x × 10^-3"],
  ])(
    "allows negative algebraic readings %s %s → %s",
    (value, unit, toUnit, expected, scaleExponent, formula) => {
      const result = convertQuantityWithFormula({ value, unit }, toUnit);
      assert(result.ok);
      expect(result.value.quantity.value).toBe(expected);
      expect(result.value.quantity.unit).toBe(toUnit);
      expect(result.value.conversion.scaleExponent).toBe(scaleExponent);
      expect(result.value.conversion.offset).toBe(0);
      expect(result.value.conversion.formula).toBe(formula);
    },
  );

  test.each([
    [0, "%", "fraction", 0, "y = x × 10^-2"],
    [100, "percent", "1", 1, "y = x × 10^-2"],
    [150, "%", "fraction", 1.5, "y = x × 10^-2"],
    [-25, "%", "fraction", -0.25, "y = x × 10^-2"],
    [0, "fraction", "%", 0, "y = x × 10^2"],
    [1, "1", "percent", 100, "y = x × 10^2"],
  ])(
    "converts percent and fraction boundaries %s %s → %s",
    (value, unit, toUnit, expected, formula) => {
      const result = convertQuantityWithFormula({ value, unit }, toUnit);
      expect(result).toEqual(
        ok({
          quantity: { value: expected, unit: toUnit },
          conversion: {
            fromUnit: unit,
            toUnit,
            scaleExponent: unit === "fraction" || unit === "1" ? 2 : -2,
            offset: 0,
            formula,
          },
        }),
      );
    },
  );

  test.each([
    [-273.15, "°C", "K", 0, 273.15, "y = x + 273.15"],
    [0, "degC", "K", 273.15, 273.15, "y = x + 273.15"],
    [0, "K", "°C", -273.15, -273.15, "y = x - 273.15"],
    [273.15, "K", "degC", 0, -273.15, "y = x - 273.15"],
    [100, "°C", "degC", 100, 0, "y = x"],
  ])(
    "converts absolute temperature boundaries %s %s → %s",
    (value, unit, toUnit, expected, offset, formula) => {
      const result = convertQuantityWithFormula({ value, unit }, toUnit, {
        temperatureKind: "absolute",
      });
      expect(result).toEqual(
        ok({
          quantity: { value: expected, unit: toUnit },
          conversion: {
            fromUnit: unit,
            toUnit,
            scaleExponent: 0,
            offset,
            formula,
          },
        }),
      );
    },
  );

  test("states identity explicitly for the same spelling and for current-density aliases", () => {
    expect(convertQuantityWithFormula({ value: -0, unit: "A/m²" }, "A/m²")).toEqual(
      ok({
        quantity: { value: -0, unit: "A/m²" },
        conversion: {
          fromUnit: "A/m²",
          toUnit: "A/m²",
          scaleExponent: 0,
          offset: 0,
          formula: "y = x",
        },
      }),
    );
    const alias = convertQuantityWithFormula(
      { value: 3, unit: "µA/cm²", significantFigures: 2 },
      "uA/cm^2",
    );
    assert(alias.ok);
    expect(Object.is(alias.value.quantity.value, 3)).toBe(true);
    expect(alias.value.conversion.formula).toBe("y = x");
    expect(alias.value.quantity.significantFigures).toBe(2);
  });

  test("keeps temperature uncertainty unshifted while the formula still shows the offset", () => {
    const result = convertQuantityWithFormula(
      quantity({
        value: 25,
        unit: "°C",
        uncertainty: 0.2,
        uncertaintyType: "instrument",
        method: "thermocouple",
        provenanceId,
      }),
      "K",
      { temperatureKind: "absolute" },
    );
    expect(result).toEqual(
      ok({
        quantity: {
          value: 298.15,
          unit: "K",
          uncertainty: 0.2,
          uncertaintyType: "instrument",
          method: "thermocouple",
          provenanceId,
        },
        conversion: {
          fromUnit: "°C",
          toUnit: "K",
          scaleExponent: 0,
          offset: 273.15,
          formula: "y = x + 273.15",
        },
      }),
    );
  });

  test("preserves metadata for a power-of-ten current-density conversion and does not mutate inputs", () => {
    const original = Object.freeze(
      quantity({
        value: 1,
        unit: "mA/cm²",
        uncertainty: 0.1,
        uncertaintyType: "sd",
        significantFigures: 2,
        method: "galvanostat",
        provenanceId,
      }),
    );
    const options = Object.freeze({ temperatureKind: "absolute" } as const);
    const snapshot = { ...original };
    const result = convertQuantityWithFormula(original, "A/m²", options);
    expect(result).toEqual(
      ok({
        quantity: { ...original, value: 10, unit: "A/m²", uncertainty: 1 },
        conversion: {
          fromUnit: "mA/cm²",
          toUnit: "A/m²",
          scaleExponent: 1,
          offset: 0,
          formula: "y = x × 10^1",
        },
      }),
    );
    expect(original).toEqual(snapshot);
    expect(options).toEqual({ temperatureKind: "absolute" });
  });

  test.each([
    [25, "°C", "K", 2],
    [300, "K", "°C", 3],
    [0, "°C", "K", 1],
  ])(
    "rejects significant figures across an offset and omits the descriptor %s %s → %s",
    (value, unit, toUnit, significantFigures) => {
      const original = Object.freeze({ value, unit, significantFigures });
      expect(convertQuantityWithFormula(original, toUnit, { temperatureKind: "absolute" })).toEqual(
        err({ code: "precision_not_transferable" }),
      );
      expect(original).toEqual({ value, unit, significantFigures });
    },
  );

  test("requires explicit absolute intent and does not return a formula", () => {
    const original = Object.freeze({ value: 0, unit: "°C" });
    expect(convertQuantityWithFormula(original, "K")).toEqual(
      err({ code: "absolute_temperature_required" }),
    );
    expect(convertQuantityWithFormula(original, "K", {})).toEqual(
      err({ code: "absolute_temperature_required" }),
    );
    expect(original).toEqual({ value: 0, unit: "°C" });
  });

  test.each([
    [-273.1500001, "°C", "K"],
    [-Number.MIN_VALUE, "K", "°C"],
  ])("rejects below-absolute-zero readings %s %s", (value, unit, toUnit) => {
    const result = convertQuantityWithFormula({ value, unit }, toUnit, {
      temperatureKind: "absolute",
    });
    assert(!result.ok);
    expect(result.error.code).toBe("validation_failed");
    expect(result).not.toHaveProperty("value");
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects nonfinite inputs %s",
    (value) => {
      const result = convertQuantityWithFormula({ value, unit: "mA/cm²" }, "A/m²");
      assert(!result.ok);
      expect(result.error.code).toBe("validation_failed");
    },
  );

  test("rejects overflow and total underflow for current density", () => {
    expect(convertQuantityWithFormula({ value: Number.MAX_VALUE, unit: "A/m²" }, "µA/cm²")).toEqual(
      err({ code: "non_finite_result" }),
    );
    expect(convertQuantityWithFormula({ value: Number.MIN_VALUE, unit: "A/m²" }, "A/cm²")).toEqual(
      err({ code: "numeric_underflow" }),
    );
  });

  test.each([
    ["Ω·m²", "A/m²"],
    ["S/cm", "Ω·cm²"],
    ["mS/cm", "ohm*m^2"],
  ])("rejects incompatible dimensions %s → %s", (unit, toUnit) => {
    expect(convertQuantityWithFormula({ value: 1, unit }, toUnit)).toEqual(
      err({ code: "incompatible_units", fromUnit: unit, toUnit }),
    );
  });

  test("does not infer area normalization from bare resistance", () => {
    expect(convertQuantityWithFormula({ value: 1, unit: "Ω" }, "Ω·m²")).toEqual(
      err({ code: "unsupported_unit", unit: "Ω" }),
    );
    expect(convertQuantityWithFormula({ value: 1, unit: "ohm" }, "ohm*m^2")).toEqual(
      err({ code: "unsupported_unit", unit: "ohm" }),
    );
  });

  test("agrees with the domain converter for every supported pair", () => {
    const absolute = { temperatureKind: "absolute" } as const;
    for (const source of SUPPORTED_UNITS) {
      for (const target of SUPPORTED_UNITS) {
        if (source.dimension !== target.dimension) continue;
        for (const fromUnit of source.symbols) {
          for (const toUnit of target.symbols) {
            const reading = { value: 1, unit: fromUnit };
            const direct = convertQuantity(reading, toUnit, absolute);
            const wrapped = convertQuantityWithFormula(reading, toUnit, absolute);
            const relation = unitConversionRelation(fromUnit, toUnit);
            assert(direct.ok);
            assert(wrapped.ok);
            assert(relation.ok);
            expect(wrapped.value.quantity).toEqual(direct.value);
            expect(wrapped.value.conversion).toEqual({
              fromUnit,
              toUnit,
              scaleExponent: relation.value.scaleExponent,
              offset: relation.value.offset,
              formula: expectedFormula(relation.value.scaleExponent, relation.value.offset),
            });
            expect(wrapped.value.quantity.value).toBe(
              applyAffine(1, relation.value.scaleExponent, relation.value.offset),
            );
          }
        }
      }
    }
  });

  test("preserves the domain converter's IEEE temperature rounding", () => {
    const result = convertQuantityWithFormula({ value: 298.16, unit: "K" }, "°C", {
      temperatureKind: "absolute",
    });
    const direct = convertQuantity({ value: 298.16, unit: "K" }, "°C", {
      temperatureKind: "absolute",
    });
    assert(result.ok);
    assert(direct.ok);
    expect(result.value.quantity).toEqual(direct.value);
    expect(String(result.value.quantity.value)).toBe("25.010000000000048");
    expect(result.value.conversion.formula).toBe("y = x - 273.15");
  });
});
