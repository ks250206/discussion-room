import * as v from "valibot";
import { IdSchema } from "./id.ts";
import { TimestampSchema } from "./timestamp.ts";

const NonblankTextSchema = v.pipe(
  v.string(),
  v.check((text) => text.trim().length > 0, "Expected nonblank text"),
);

const provenanceEntries = {
  id: IdSchema,
  sourceIds: v.pipe(v.array(IdSchema), v.readonly()),
  createdBy: NonblankTextSchema,
  method: NonblankTextSchema,
  timestamp: TimestampSchema,
};

const NON_AI_ORIGINS = ["measurement", "literature", "calculation", "manual"] as const;

/** These categories describe origin, not approval status or evidential strength. */
export const OriginTypeSchema = v.picklist([...NON_AI_ORIGINS, "ai"]);

/** AI identity survives human approval; timestamp records generation time. */
export const ProvenanceSchema = v.pipe(
  v.union([
    v.strictObject({
      ...provenanceEntries,
      originType: v.picklist(NON_AI_ORIGINS),
    }),
    v.strictObject({
      ...provenanceEntries,
      originType: v.literal("ai"),
      generatedBy: v.literal("ai"),
      modelId: NonblankTextSchema,
    }),
  ]),
  v.readonly(),
);

export type OriginType = v.InferOutput<typeof OriginTypeSchema>;
export type Provenance = v.InferOutput<typeof ProvenanceSchema>;
