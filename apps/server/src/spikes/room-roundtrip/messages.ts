import * as v from "valibot";

const counter = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER));
const projectId = v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_-]{1,32}$/));
const position = v.strictObject({
  x: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(560)),
  y: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(300)),
});
export const inputSchema = v.variant("type", [
  v.strictObject({ type: v.literal("join"), projectId }),
  v.strictObject({ type: v.literal("leave") }),
  v.strictObject({ type: v.literal("move"), requestId: counter, position }),
]);
export type Position = v.InferOutput<typeof position>;
const members = v.array(v.string());
export const outputSchema = v.variant("type", [
  v.strictObject({ type: v.literal("ready"), connectionId: v.string() }),
  v.strictObject({ type: v.literal("left") }),
  v.strictObject({ type: v.literal("reject"), code: v.string() }),
  v.strictObject({ type: v.literal("snapshot"), projectId, revision: counter, position, members }),
  v.strictObject({ type: v.literal("members"), projectId, members }),
  v.strictObject({
    type: v.literal("position"),
    projectId,
    revision: counter,
    position,
    actor: v.string(),
  }),
  v.strictObject({ type: v.literal("ack"), requestId: counter, revision: counter }),
]);
export type Output = v.InferOutput<typeof outputSchema>;
