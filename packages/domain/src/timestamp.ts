import * as v from "valibot";

// Deliberately a documented subset of ISO 8601: full calendar date/time and explicit zone.
const timestampPattern =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

function hasValidCalendarDate(value: string): boolean {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDay = month === 2 ? (isLeapYear ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return day <= maxDay;
}

/** Preserve the supplied offset and precision; never normalize or repair input. */
export const TimestampSchema = v.pipe(
  v.string(),
  v.regex(timestampPattern, "Expected an ISO 8601 timestamp with an explicit timezone"),
  v.check(hasValidCalendarDate, "Expected a real calendar date"),
  v.brand("Timestamp"),
);

export type Timestamp = v.InferOutput<typeof TimestampSchema>;
