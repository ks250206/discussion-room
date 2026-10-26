import {
  convertQuantity,
  err,
  ok,
  unitConversionRelation,
  type Result,
  type ScientificQuantity,
  type UnitConversionError,
  type UnitConversionOptions,
  type ValidationError,
} from "@discussion-room/domain";

export type UnitConversionDescriptor = {
  readonly fromUnit: string;
  readonly toUnit: string;
  readonly scaleExponent: number;
  readonly offset: number;
  readonly formula: string;
};

export type ConvertedScientificQuantity = {
  readonly quantity: ScientificQuantity;
  readonly conversion: UnitConversionDescriptor;
};

/**
 * Human-readable form of y = x × 10^scaleExponent + offset.
 * A zero offset is omitted. Both terms zero is the explicit identity y = x.
 * 10^0 is omitted. A negative offset is written as subtraction.
 */
function formatConversionFormula(scaleExponent: number, offset: number): string {
  if (scaleExponent === 0 && offset === 0) return "y = x";
  const scaled = scaleExponent === 0 ? "x" : `x × 10^${String(scaleExponent)}`;
  if (offset === 0) return `y = ${scaled}`;
  const magnitude = String(offset < 0 ? -offset : offset);
  const sign = offset < 0 ? "-" : "+";
  return `y = ${scaled} ${sign} ${magnitude}`;
}

/**
 * Convert with the domain converter, then describe that same affine map.
 * Factors come from unitConversionRelation (SUPPORTED_UNITS). The numeric result
 * is not recomputed here. The descriptor is attached only when conversion succeeds.
 */
export function convertQuantityWithFormula(
  quantity: ScientificQuantity,
  toUnit: string,
  options?: UnitConversionOptions,
): Result<ConvertedScientificQuantity, UnitConversionError | ValidationError> {
  const converted =
    options === undefined
      ? convertQuantity(quantity, toUnit)
      : convertQuantity(quantity, toUnit, options);
  if (!converted.ok) return converted;
  const relation = unitConversionRelation(quantity.unit, toUnit);
  if (!relation.ok) return err(relation.error);
  return ok({
    quantity: converted.value,
    conversion: {
      fromUnit: relation.value.fromUnit,
      toUnit: relation.value.toUnit,
      scaleExponent: relation.value.scaleExponent,
      offset: relation.value.offset,
      formula: formatConversionFormula(relation.value.scaleExponent, relation.value.offset),
    },
  });
}
