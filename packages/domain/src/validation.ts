import * as v from "valibot";
import { err, ok, type Result } from "./result.ts";

export type ValidationError = {
  readonly code: "validation_failed";
  readonly issues: readonly [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]];
};

/** Validate unknown boundary data, preserving Valibot's issue paths and metadata. */
export function validate<TSchema extends v.GenericSchema>(
  schema: TSchema,
  input: unknown,
): Result<v.InferOutput<TSchema>, ValidationError> {
  const result = v.safeParse(schema, input);
  return result.success
    ? ok(result.output)
    : err({ code: "validation_failed", issues: result.issues });
}
