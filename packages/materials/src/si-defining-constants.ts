import { err, ok, type Result } from "@discussion-room/domain";

/**
 * A bounded reference subset of three exact SI defining constants.
 * exactDecimal is the defining decimal. value is its IEEE 754 binary64 approximation.
 * These are not measured observations and carry no synthetic measurement provenance.
 * Gas constant R and Faraday constant F are derived and are not included.
 */
export type SiDefiningConstant = {
  readonly id: "elementaryCharge" | "boltzmannConstant" | "avogadroConstant";
  readonly name: string;
  readonly symbol: string;
  readonly value: number;
  readonly exactDecimal: string;
  readonly unit: string;
  readonly exact: true;
  readonly definition: string;
  readonly sourceUrl: string;
  readonly definitionVersion: "SI 2019";
};

export type SiDefiningConstantId = SiDefiningConstant["id"];

export type UnknownSiDefiningConstantError = {
  readonly code: "unknown_constant";
  readonly id: string;
};

const SOURCE_URL = "https://www.bipm.org/en/measurement-units/si-defining-constants";

const ELEMENTARY_CHARGE = Object.freeze({
  id: "elementaryCharge",
  name: "elementary charge",
  symbol: "e",
  value: 1.602176634e-19,
  exactDecimal: "1.602176634e-19",
  unit: "C",
  exact: true,
  definition:
    "Exact SI defining constant for the ampere, in force from 2019-05-20 as 1.602176634 × 10^-19 C. exactDecimal is that exact decimal; value is its IEEE 754 binary64 approximation, not a measured observation.",
  sourceUrl: SOURCE_URL,
  definitionVersion: "SI 2019",
} as const satisfies SiDefiningConstant);

const BOLTZMANN_CONSTANT = Object.freeze({
  id: "boltzmannConstant",
  name: "Boltzmann constant",
  symbol: "k_B",
  value: 1.380649e-23,
  exactDecimal: "1.380649e-23",
  unit: "J/K",
  exact: true,
  definition:
    "Exact SI defining constant for the kelvin, in force from 2019-05-20 as 1.380649 × 10^-23 J/K. The SI symbol is k; this record uses k_B. exactDecimal is that exact decimal; value is its IEEE 754 binary64 approximation, not a measured observation.",
  sourceUrl: SOURCE_URL,
  definitionVersion: "SI 2019",
} as const satisfies SiDefiningConstant);

const AVOGADRO_CONSTANT = Object.freeze({
  id: "avogadroConstant",
  name: "Avogadro constant",
  symbol: "N_A",
  value: 6.02214076e23,
  exactDecimal: "6.02214076e23",
  unit: "mol^-1",
  exact: true,
  definition:
    "Exact SI defining constant for the mole, in force from 2019-05-20 as 6.02214076 × 10^23 mol^-1. exactDecimal is that exact decimal; value is its IEEE 754 binary64 approximation, not a measured observation.",
  sourceUrl: SOURCE_URL,
  definitionVersion: "SI 2019",
} as const satisfies SiDefiningConstant);

/** The only constant table. Records and this list are frozen; fields are primitives. */
export const SI_DEFINING_CONSTANTS = Object.freeze([
  ELEMENTARY_CHARGE,
  BOLTZMANN_CONSTANT,
  AVOGADRO_CONSTANT,
] as const);

/**
 * Typed lookup over the frozen list. Unknown ids return Result rather than undefined or a default.
 * There is no string index signature. Symbols, R, and F are not keys.
 */
export function lookupSiDefiningConstant(
  id: string,
): Result<SiDefiningConstant, UnknownSiDefiningConstantError> {
  for (const constant of SI_DEFINING_CONSTANTS) {
    if (constant.id === id) return ok(constant);
  }
  return err({ code: "unknown_constant", id });
}
