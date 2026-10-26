export const packageName = "@discussion-room/materials";

export {
  convertQuantityWithFormula,
  type ConvertedScientificQuantity,
  type UnitConversionDescriptor,
} from "./quantity-conversion.ts";
export {
  lookupSiDefiningConstant,
  SI_DEFINING_CONSTANTS,
  type SiDefiningConstant,
  type SiDefiningConstantId,
  type UnknownSiDefiningConstantError,
} from "./si-defining-constants.ts";
