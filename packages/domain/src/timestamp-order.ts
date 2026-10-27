import { err, ok, type Result } from "./result.ts";
import type { Timestamp } from "./timestamp.ts";

export type ChronologyError = {
  readonly code: "chronology_undetermined";
  readonly message: string;
};

function parts(value: Timestamp) {
  const offsetStart = value.endsWith("Z") ? value.length - 1 : value.length - 6;
  return {
    wholeSecond: Date.parse(value.slice(0, 19) + value.slice(offsetStart)),
    fraction: value[19] === "." ? value.slice(20, offsetStart) : "",
  };
}

/**
 * Compare validated timestamps without truncating arbitrary fractional-second precision.
 * Date parses only whole seconds and explicit known offsets; stored spellings are untouched.
 * RFC 3339 -00:00 denotes an unknown offset and cannot establish an instant/causal order.
 */
export function compareTimestamps(
  left: Timestamp,
  right: Timestamp,
): Result<-1 | 0 | 1, ChronologyError> {
  if (left.endsWith("-00:00") || right.endsWith("-00:00"))
    return err({
      code: "chronology_undetermined",
      message: "An unknown -00:00 offset cannot establish revision or registration chronology",
    });
  const a = parts(left);
  const b = parts(right);
  if (!Number.isFinite(a.wholeSecond) || !Number.isFinite(b.wholeSecond))
    return err({
      code: "chronology_undetermined",
      message: "Timestamp cannot be compared as an absolute instant",
    });
  if (a.wholeSecond !== b.wholeSecond) return ok(a.wholeSecond < b.wholeSecond ? -1 : 1);
  const width = Math.max(a.fraction.length, b.fraction.length);
  const aFraction = a.fraction.padEnd(width, "0");
  const bFraction = b.fraction.padEnd(width, "0");
  return ok(aFraction === bFraction ? 0 : aFraction < bFraction ? -1 : 1);
}
