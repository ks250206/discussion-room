import * as v from "valibot";

export const pyodideVersion = "314.0.7";
export const runtimeIndexUrl = `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`;
export const outputLimit = 8192;
const identifier = v.pipe(v.number(), v.integer(), v.minValue(1));
const measurement = v.pipe(v.number(), v.finite(), v.minValue(0));
const boundedText = v.pipe(v.string(), v.maxLength(outputLimit));
export const demoSchema = v.picklist(["numpy", "infinite", "exception"]);
export type Demo = v.InferOutput<typeof demoSchema>;
export const requestSchema = v.variant("type", [
  v.object({ type: v.literal("initialize") }),
  v.object({ type: v.literal("run"), runId: identifier, demo: demoSchema }),
]);
export type WorkerRequest = v.InferOutput<typeof requestSchema>;
export const responseSchema = v.variant("type", [
  v.object({ type: v.literal("ready"), heapBytes: v.nullable(measurement) }),
  v.object({
    type: v.literal("result"),
    runId: identifier,
    output: boundedText,
    computeMs: measurement,
    heapBytes: v.nullable(measurement),
  }),
  v.object({ type: v.literal("error"), runId: v.nullable(identifier), message: boundedText }),
]);
export type WorkerResponse = v.InferOutput<typeof responseSchema>;
export function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, outputLimit);
}

export function validateOutput(
  output: string,
): { ok: true; value: string } | { ok: false; error: string } {
  return output.length <= outputLimit
    ? { ok: true, value: output }
    : { ok: false, error: `Output exceeds ${outputLimit} characters; no partial result returned` };
}
