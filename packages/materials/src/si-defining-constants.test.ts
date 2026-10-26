import { err, ok } from "@discussion-room/domain";
import { assert, describe, expect, test } from "vite-plus/test";
import { lookupSiDefiningConstant, SI_DEFINING_CONSTANTS } from "./index.ts";

const FIELDS = [
  "definition",
  "definitionVersion",
  "exact",
  "exactDecimal",
  "id",
  "name",
  "sourceUrl",
  "symbol",
  "unit",
  "value",
];

describe("SI defining constants", () => {
  test("publishes the three exact SI 2019 values, units, and source", () => {
    expect(SI_DEFINING_CONSTANTS.map((constant) => constant.id)).toEqual([
      "elementaryCharge",
      "boltzmannConstant",
      "avogadroConstant",
    ]);
    expect(SI_DEFINING_CONSTANTS.map((constant) => constant.symbol)).toEqual(["e", "k_B", "N_A"]);
    expect(SI_DEFINING_CONSTANTS.map((constant) => constant.unit)).toEqual(["C", "J/K", "mol^-1"]);
    expect(SI_DEFINING_CONSTANTS.map((constant) => constant.exactDecimal)).toEqual([
      "1.602176634e-19",
      "1.380649e-23",
      "6.02214076e23",
    ]);
    expect(SI_DEFINING_CONSTANTS.map((constant) => constant.value)).toEqual([
      1.602176634e-19, 1.380649e-23, 6.02214076e23,
    ]);
    for (const constant of SI_DEFINING_CONSTANTS) {
      expect(constant.exact).toBe(true);
      expect(constant.definitionVersion).toBe("SI 2019");
      expect(constant.sourceUrl).toBe(
        "https://www.bipm.org/en/measurement-units/si-defining-constants",
      );
      expect(constant.definition).toContain("2019-05-20");
      expect(constant.definition).toContain("IEEE 754");
      expect(constant.definition).toContain("not a measured observation");
      expect(Object.keys(constant).toSorted()).toEqual(FIELDS);
      expect(constant).not.toHaveProperty("uncertainty");
      expect(constant).not.toHaveProperty("provenanceId");
      expect(constant).not.toHaveProperty("originType");
    }
  });

  test("keeps the exact decimal distinct from the binary64 expansion", () => {
    const [elementary, boltzmann, avogadro] = SI_DEFINING_CONSTANTS;
    assert(elementary !== undefined);
    assert(boltzmann !== undefined);
    assert(avogadro !== undefined);
    expect(elementary.definition).toContain("for the ampere");
    expect(elementary.definition).toContain("in force from 2019-05-20");
    expect(elementary.value.toPrecision(21)).toBe("1.60217663399999989376e-19");
    expect(boltzmann.value.toPrecision(21)).toBe("1.38064900000000009215e-23");
    expect(avogadro.value.toPrecision(21)).toBe("6.02214075999999987024e+23");
    expect(elementary.exactDecimal).not.toBe(elementary.value.toPrecision(21));
    expect(boltzmann.exactDecimal).not.toBe(boltzmann.value.toPrecision(21));
    expect(avogadro.exactDecimal).toBe("6.02214076e23");
    expect(String(avogadro.value)).toBe("6.02214076e+23");
    expect(avogadro.exactDecimal).not.toBe(String(avogadro.value));
    expect(Number(elementary.exactDecimal)).toBe(elementary.value);
    expect(Number(boltzmann.exactDecimal)).toBe(boltzmann.value);
    expect(Number(avogadro.exactDecimal)).toBe(avogadro.value);
  });

  test("freezes the list and each record", () => {
    const values = SI_DEFINING_CONSTANTS.map((constant) => constant.value);
    expect(Object.isFrozen(SI_DEFINING_CONSTANTS)).toBe(true);
    expect(Reflect.set(SI_DEFINING_CONSTANTS, "0", null)).toBe(false);
    for (const constant of SI_DEFINING_CONSTANTS) {
      expect(Object.isFrozen(constant)).toBe(true);
      expect(Reflect.set(constant, "value", 1)).toBe(false);
      expect(Reflect.set(constant, "exactDecimal", "0")).toBe(false);
      expect(Reflect.set(constant, "exact", false)).toBe(false);
    }
    expect(SI_DEFINING_CONSTANTS.map((constant) => constant.value)).toEqual(values);
  });

  test("returns the frozen record for a known id and Result for an unknown id", () => {
    const found = lookupSiDefiningConstant("boltzmannConstant");
    expect(found).toEqual(ok(SI_DEFINING_CONSTANTS[1]));
    assert(found.ok);
    expect(found.value).toBe(SI_DEFINING_CONSTANTS[1]);
    expect(found.value.symbol).toBe("k_B");
    expect(found.value.name).toBe("Boltzmann constant");

    expect(lookupSiDefiningConstant("R")).toEqual(err({ code: "unknown_constant", id: "R" }));
    expect(lookupSiDefiningConstant("F")).toEqual(err({ code: "unknown_constant", id: "F" }));
    expect(lookupSiDefiningConstant("e")).toEqual(err({ code: "unknown_constant", id: "e" }));
    expect(lookupSiDefiningConstant("k")).toEqual(err({ code: "unknown_constant", id: "k" }));
    expect(lookupSiDefiningConstant("N_A")).toEqual(err({ code: "unknown_constant", id: "N_A" }));
    expect(lookupSiDefiningConstant("ElementaryCharge")).toEqual(
      err({ code: "unknown_constant", id: "ElementaryCharge" }),
    );
    expect(lookupSiDefiningConstant("elementaryCharge ")).toEqual(
      err({ code: "unknown_constant", id: "elementaryCharge " }),
    );
    const missing = lookupSiDefiningConstant("not-a-constant");
    assert(!missing.ok);
    expect(missing).not.toHaveProperty("value");
    expect(missing.error).toEqual({ code: "unknown_constant", id: "not-a-constant" });
  });
});
