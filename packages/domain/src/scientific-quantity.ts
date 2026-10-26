import * as v from "valibot";
import { IdSchema } from "./id.ts";
import { err, ok, type Result } from "./result.ts";
import { validate, type ValidationError } from "./validation.ts";

export const FiniteNumberSchema = v.pipe(v.number(), v.finite());

/** Unit spelling is retained. Unsupported units may be stored, never guessed. */
export const UnitSchema = v.pipe(
  v.string(),
  v.nonEmpty(),
  v.check((unit) => unit === unit.trim(), "Unit must not have surrounding whitespace"),
);

const NonblankTextSchema = v.pipe(
  v.string(),
  v.check((text) => text.trim().length > 0, "Expected nonblank text"),
);

export const UncertaintyTypeSchema = v.picklist(["sd", "se", "ci95", "instrument"]);

function isPhysicalTemperature(quantity: { value: number; unit: string }): boolean {
  const unit = findUnit(quantity.unit);
  return unit?.dimension !== "temperature" || quantity.value >= -unit.offset;
}

/** Unknown fields fail rather than silently discarding interpretation metadata. */
export const ScientificQuantitySchema = v.pipe(
  v.strictObject({
    value: FiniteNumberSchema,
    unit: UnitSchema,
    uncertainty: v.exactOptional(v.pipe(FiniteNumberSchema, v.minValue(0))),
    uncertaintyType: v.exactOptional(UncertaintyTypeSchema),
    significantFigures: v.exactOptional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
    method: v.exactOptional(NonblankTextSchema),
    provenanceId: v.exactOptional(IdSchema),
  }),
  v.forward(
    v.check(
      (quantity) => quantity.uncertaintyType === undefined || quantity.uncertainty !== undefined,
      "Uncertainty type requires an uncertainty value",
    ),
    ["uncertaintyType"],
  ),
  v.forward(
    v.check(
      (quantity) => isPhysicalTemperature(quantity),
      "Absolute temperature must not be below absolute zero",
    ),
    ["value"],
  ),
);

export type ScientificQuantity = Readonly<v.InferOutput<typeof ScientificQuantitySchema>>;
export type UncertaintyType = v.InferOutput<typeof UncertaintyTypeSchema>;

/** Explicit aliases only; no prefix parsing or dimension inference. */
export const SUPPORTED_UNITS = Object.freeze(
  (
    [
      { symbols: ["K"], dimension: "temperature", exponent: 0, offset: 0 },
      { symbols: ["°C", "degC"], dimension: "temperature", exponent: 0, offset: 273.15 },
      { symbols: ["%", "percent"], dimension: "ratio", exponent: -2, offset: 0 },
      { symbols: ["1", "fraction"], dimension: "ratio", exponent: 0, offset: 0 },
      { symbols: ["m"], dimension: "length", exponent: 0, offset: 0 },
      { symbols: ["cm"], dimension: "length", exponent: -2, offset: 0 },
      { symbols: ["mm"], dimension: "length", exponent: -3, offset: 0 },
      { symbols: ["µm", "μm", "um"], dimension: "length", exponent: -6, offset: 0 },
      { symbols: ["nm"], dimension: "length", exponent: -9, offset: 0 },
      { symbols: ["Å", "angstrom"], dimension: "length", exponent: -10, offset: 0 },
      { symbols: ["S/m"], dimension: "conductivity", exponent: 0, offset: 0 },
      { symbols: ["S/cm"], dimension: "conductivity", exponent: 2, offset: 0 },
      { symbols: ["mS/cm"], dimension: "conductivity", exponent: -1, offset: 0 },
      { symbols: ["Pa"], dimension: "pressure", exponent: 0, offset: 0 },
      { symbols: ["kPa"], dimension: "pressure", exponent: 3, offset: 0 },
      { symbols: ["MPa"], dimension: "pressure", exponent: 6, offset: 0 },
      { symbols: ["Ω·m²", "ohm*m^2"], dimension: "areaResistance", exponent: 0, offset: 0 },
      { symbols: ["Ω·cm²", "ohm*cm^2"], dimension: "areaResistance", exponent: -4, offset: 0 },
      { symbols: ["A/m²", "A/m^2"], dimension: "currentDensity", exponent: 0, offset: 0 },
      { symbols: ["A/cm²", "A/cm^2"], dimension: "currentDensity", exponent: 4, offset: 0 },
      { symbols: ["mA/cm²", "mA/cm^2"], dimension: "currentDensity", exponent: 1, offset: 0 },
      {
        symbols: ["µA/cm²", "μA/cm²", "uA/cm^2"],
        dimension: "currentDensity",
        exponent: -2,
        offset: 0,
      },
    ] as const
  ).map((unit) => {
    Object.freeze(unit.symbols);
    return Object.freeze(unit);
  }),
);

type SupportedUnit = (typeof SUPPORTED_UNITS)[number];

function findUnit(symbol: string): SupportedUnit | undefined {
  return SUPPORTED_UNITS.find((unit) => unit.symbols.some((alias) => alias === symbol));
}

export type NumericError =
  | { readonly code: "division_by_zero" }
  | { readonly code: "non_finite_result" }
  | { readonly code: "numeric_underflow" };

export type UnitConversionError =
  | { readonly code: "precision_not_transferable" }
  | { readonly code: "absolute_temperature_required" }
  | { readonly code: "unsupported_unit"; readonly unit: string }
  | { readonly code: "incompatible_units"; readonly fromUnit: string; readonly toUnit: string }
  | NumericError;

/** Detect overflow and complete underflow; this is still IEEE 754, not decimal arithmetic. */
function finiteResult(value: number, nonzeroExpected: boolean): Result<number, NumericError> {
  if (!Number.isFinite(value)) return err({ code: "non_finite_result" });
  if (value === 0 && nonzeroExpected) return err({ code: "numeric_underflow" });
  return ok(value);
}

const DivisionInputSchema = v.strictObject({
  numerator: FiniteNumberSchema,
  denominator: FiniteNumberSchema,
});

/** Numeric division only: does not infer a unit, significant figures, or uncertainty. */
export function divideFinite(
  numerator: number,
  denominator: number,
): Result<number, NumericError | ValidationError> {
  const input = validate(DivisionInputSchema, { numerator, denominator });
  if (!input.ok) return input;
  if (input.value.denominator === 0) return err({ code: "division_by_zero" });
  return finiteResult(input.value.numerator / input.value.denominator, input.value.numerator !== 0);
}

/** Scale once using an integer power, avoiding division of inexact decimal scales. */
function scaleByPowerOfTen(value: number, exponent: number): number {
  return exponent >= 0 ? value * 10 ** exponent : value / 10 ** -exponent;
}

export type UnitConversionRelation = {
  readonly fromUnit: string;
  readonly toUnit: string;
  readonly scaleExponent: number;
  readonly offset: number;
};

/**
 * Affine map y = x × 10^scaleExponent + offset for one explicit same-dimension pair.
 * Factors are read only from SUPPORTED_UNITS. Absolute zero, significant figures,
 * absolute-temperature intent, and finite magnitude stay in convertQuantity.
 */
export function unitConversionRelation(
  fromUnit: string,
  toUnit: string,
): Result<
  UnitConversionRelation,
  Extract<UnitConversionError, { readonly code: "unsupported_unit" | "incompatible_units" }>
> {
  const source = findUnit(fromUnit);
  if (source === undefined) return err({ code: "unsupported_unit", unit: fromUnit });
  const target = findUnit(toUnit);
  if (target === undefined) return err({ code: "unsupported_unit", unit: toUnit });
  if (source.dimension !== target.dimension) {
    return err({ code: "incompatible_units", fromUnit, toUnit });
  }
  return ok({
    fromUnit,
    toUnit,
    scaleExponent: source.exponent - target.exponent,
    offset: scaleByPowerOfTen(source.offset - target.offset, -target.exponent),
  });
}

const UnitConversionOptionsSchema = v.strictObject({
  temperatureKind: v.exactOptional(v.literal("absolute")),
});

export type UnitConversionOptions = Readonly<v.InferOutput<typeof UnitConversionOptionsSchema>>;

const ConversionInputSchema = v.strictObject({
  quantity: ScientificQuantitySchema,
  toUnit: UnitSchema,
  options: UnitConversionOptionsSchema,
});

/**
 * Convert only explicitly supported units of the same dimension. Temperatures are
 * absolute readings and offset conversions require explicit absolute intent.
 * Uncertainty is an absolute magnitude (CI95: half-width). Significant figures
 * cannot transfer across an offset: reject instead of changing or dropping them.
 * Scale and offset come from unitConversionRelation.
 */
export function convertQuantity(
  quantity: ScientificQuantity,
  toUnit: string,
  options: UnitConversionOptions = {},
): Result<ScientificQuantity, UnitConversionError | ValidationError> {
  const input = validate(ConversionInputSchema, { quantity, toUnit, options });
  if (!input.ok) return input;
  const relation = unitConversionRelation(input.value.quantity.unit, input.value.toUnit);
  if (!relation.ok) return relation;
  const original = input.value.quantity;
  const { scaleExponent, offset } = relation.value;
  if (offset !== 0 && original.significantFigures !== undefined) {
    return err({ code: "precision_not_transferable" });
  }
  if (offset !== 0 && input.value.options.temperatureKind !== "absolute") {
    return err({ code: "absolute_temperature_required" });
  }
  const scaledValue = scaleByPowerOfTen(original.value, scaleExponent);
  // Avoid an intermediate base-unit value that could overflow unnecessarily.
  const value = finiteResult(
    offset === 0 ? scaledValue : scaledValue + offset,
    offset === 0 && original.value !== 0,
  );
  if (!value.ok) return value;
  const uncertainty =
    original.uncertainty === undefined
      ? undefined
      : finiteResult(
          scaleByPowerOfTen(original.uncertainty, scaleExponent),
          original.uncertainty !== 0,
        );
  if (uncertainty !== undefined && !uncertainty.ok) return uncertainty;
  return validate(ScientificQuantitySchema, {
    ...original,
    value: value.value,
    unit: input.value.toUnit,
    ...(uncertainty === undefined ? {} : { uncertainty: uncertainty.value }),
  });
}
