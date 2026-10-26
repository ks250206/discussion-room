import { ulid } from "ulid";
import * as v from "valibot";
import { validate, type ValidationError } from "./validation.ts";
import type { Result } from "./result.ts";

/** Canonical uppercase ULIDs avoid multiple spellings of the same identifier. */
export const IdSchema = v.pipe(
  v.string(),
  v.ulid(),
  v.check((value) => value === value.toUpperCase(), "Expected an uppercase ULID"),
  v.brand("Id"),
);

export type Id = v.InferOutput<typeof IdSchema>;

export type IdGenerator = () => string;

/**
 * The default generator uses ulid's cryptographically secure platform adapter.
 * Tests may supply a deterministic generator; its output is validated as well.
 * Entropy/runtime failures are unexpected faults and are not converted to input errors.
 */
export function createId(generate: IdGenerator = ulid): Result<Id, ValidationError> {
  return validate(IdSchema, generate());
}
