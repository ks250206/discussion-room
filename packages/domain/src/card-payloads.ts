import * as v from "valibot";
import { IdSchema } from "./id.ts";
import { ProvenanceSchema } from "./provenance.ts";
import { ScientificQuantitySchema } from "./scientific-quantity.ts";
import { TimestampSchema } from "./timestamp.ts";

const textSchema = v.pipe(
  v.string(),
  v.check((text) => text.trim().length > 0, "Expected nonblank text"),
);
const textsSchema = v.pipe(v.array(textSchema), v.readonly());
const idsSchema = v.pipe(v.array(IdSchema), v.readonly());
const quantitySchema = v.pipe(ScientificQuantitySchema, v.readonly());

export const GeneratedBySchema = v.picklist(["human", "ai"]);
export type GeneratedBy = v.InferOutput<typeof GeneratedBySchema>;

const humanProvenanceSchema = v.pipe(
  ProvenanceSchema,
  v.check(
    (provenance) => provenance.originType !== "ai",
    "Human origin cannot carry AI provenance",
  ),
);
const aiProvenanceSchema = v.pipe(
  ProvenanceSchema,
  v.check((provenance) => provenance.originType === "ai", "AI origin requires AI provenance"),
);

/** Attribution describes content origin, independently of revision editor and approval. */
function cardPayload<TEntries extends v.ObjectEntries>(entries: TEntries) {
  return v.pipe(
    v.variant("generatedBy", [
      v.strictObject({
        ...entries,
        author: textSchema,
        generatedBy: v.literal("human"),
        provenance: v.exactOptional(humanProvenanceSchema),
      }),
      v.strictObject({
        ...entries,
        author: textSchema,
        generatedBy: v.literal("ai"),
        provenance: aiProvenanceSchema,
      }),
    ]),
    v.readonly(),
  );
}

/** No value or unit is fabricated for an unknown condition. */
export const ConditionValueSchema = v.pipe(
  v.variant("type", [
    v.strictObject({ type: v.literal("quantity"), quantity: quantitySchema }),
    v.strictObject({ type: v.literal("qualitative"), description: textSchema }),
    v.strictObject({ type: v.literal("unknown"), reason: textSchema }),
  ]),
  v.readonly(),
);
export type ConditionValue = v.InferOutput<typeof ConditionValueSchema>;

export const ScientificConditionSchema = v.pipe(
  v.strictObject({ name: textSchema, value: ConditionValueSchema }),
  v.readonly(),
);
export type ScientificCondition = v.InferOutput<typeof ScientificConditionSchema>;
const conditionsSchema = v.pipe(v.array(ScientificConditionSchema), v.readonly());

/** Whole measurement context can be explicitly unknown; known context is nonempty. */
export const MeasurementConditionsSchema = v.pipe(
  v.variant("status", [
    v.strictObject({
      status: v.literal("known"),
      values: v.pipe(v.array(ScientificConditionSchema), v.minLength(1), v.readonly()),
    }),
    v.strictObject({ status: v.literal("unknown"), reason: textSchema }),
  ]),
  v.readonly(),
);
export type MeasurementConditions = v.InferOutput<typeof MeasurementConditionsSchema>;

export const HypothesisStatusSchema = v.picklist([
  "proposed",
  "under-test",
  "consistent",
  "challenged",
  "inconclusive",
  "superseded",
]);
export type HypothesisStatus = v.InferOutput<typeof HypothesisStatusSchema>;

export const QuestionPayloadSchema = cardPayload({
  title: textSchema,
  question: textSchema,
  objectives: textsSchema,
  constraints: textsSchema,
});
export type QuestionPayload = v.InferOutput<typeof QuestionPayloadSchema>;

export const HypothesisPayloadSchema = cardPayload({
  title: textSchema,
  statement: textSchema,
  applicability: textsSchema,
  refutationCriteria: textsSchema,
  status: HypothesisStatusSchema,
  tags: textsSchema,
  predictionIds: idsSchema,
});
export type HypothesisPayload = v.InferOutput<typeof HypothesisPayloadSchema>;

export const MechanismPayloadSchema = cardPayload({
  title: textSchema,
  explanation: textSchema,
  applicability: textsSchema,
  assumptions: textsSchema,
});
export type MechanismPayload = v.InferOutput<typeof MechanismPayloadSchema>;

export const ExpectedObservationSchema = v.pipe(
  v.variant("type", [
    v.strictObject({
      type: v.literal("qualitative"),
      observable: textSchema,
      description: textSchema,
    }),
    v.strictObject({
      type: v.literal("quantitative"),
      observable: textSchema,
      quantity: quantitySchema,
    }),
  ]),
  v.readonly(),
);
export type ExpectedObservation = v.InferOutput<typeof ExpectedObservationSchema>;

export const DiscriminationRuleSchema = v.pipe(
  v.strictObject({
    outcome: textSchema,
    supportsHypothesisIds: idsSchema,
    challengesHypothesisIds: idsSchema,
    rationale: textSchema,
  }),
  v.check(
    (rule) => rule.supportsHypothesisIds.length + rule.challengesHypothesisIds.length > 0,
    "A discrimination rule must identify at least one hypothesis",
  ),
  v.check(
    (rule) => !rule.supportsHypothesisIds.some((id) => rule.challengesHypothesisIds.includes(id)),
    "A rule cannot both support and challenge the same hypothesis",
  ),
  v.readonly(),
);
export type DiscriminationRule = v.InferOutput<typeof DiscriminationRuleSchema>;

/** Records the declared registration; history/chronology enforcement belongs to command application. */
export const PredictionRegistrationSchema = v.pipe(
  v.variant("status", [
    v.strictObject({
      status: v.literal("draft"),
      rules: v.pipe(v.array(DiscriminationRuleSchema), v.readonly()),
    }),
    v.strictObject({
      status: v.literal("registered"),
      registeredAt: TimestampSchema,
      registeredBy: textSchema,
      rules: v.pipe(v.array(DiscriminationRuleSchema), v.minLength(1), v.readonly()),
    }),
  ]),
  v.readonly(),
);
export type PredictionRegistration = v.InferOutput<typeof PredictionRegistrationSchema>;

export const PredictionPayloadSchema = cardPayload({
  title: textSchema,
  applicability: textsSchema,
  interventionFactors: conditionsSchema,
  fixedFactors: conditionsSchema,
  expectedObservations: v.pipe(v.array(ExpectedObservationSchema), v.minLength(1), v.readonly()),
  model: v.exactOptional(textSchema),
  registration: PredictionRegistrationSchema,
});
export type PredictionPayload = v.InferOutput<typeof PredictionPayloadSchema>;

export const ExperimentPayloadSchema = cardPayload({
  title: textSchema,
  objective: textSchema,
  protocol: textSchema,
  controls: textsSchema,
  conditions: conditionsSchema,
  predictionIds: idsSchema,
  decisionCriteria: textsSchema,
});
export type ExperimentPayload = v.InferOutput<typeof ExperimentPayloadSchema>;

const measuredObservationSchema = v.pipe(
  v.strictObject({ observable: textSchema, quantity: quantitySchema }),
  v.readonly(),
);
const fileHashSchema = v.pipe(
  v.strictObject({
    algorithm: v.literal("sha256"),
    digest: v.pipe(v.string(), v.regex(/^[a-fA-F0-9]{64}$/u)),
  }),
  v.readonly(),
);

/** Observation stores reported facts, without evidence polarity or hypothesis status. */
export const ObservationPayloadSchema = cardPayload({
  title: textSchema,
  observations: v.pipe(v.array(measuredObservationSchema), v.minLength(1), v.readonly()),
  measurementConditions: MeasurementConditionsSchema,
  sourceIds: idsSchema,
  analysisCodeIds: idsSchema,
  sourceFileHash: v.exactOptional(fileHashSchema),
});
export type ObservationPayload = v.InferOutput<typeof ObservationPayloadSchema>;

export const SourcePayloadSchema = cardPayload({
  title: textSchema,
  sourceType: v.picklist(["paper", "file", "instrument-log", "web", "other"]),
  reference: textSchema,
  description: v.string(),
});
export type SourcePayload = v.InferOutput<typeof SourcePayloadSchema>;

export const NotePayloadSchema = cardPayload({ title: textSchema, markdown: v.string() });
export type NotePayload = v.InferOutput<typeof NotePayloadSchema>;

export const FramePayloadSchema = cardPayload({
  title: textSchema,
  description: v.string(),
  artifactIds: idsSchema,
});
export type FramePayload = v.InferOutput<typeof FramePayloadSchema>;

export const ImagePayloadSchema = cardPayload({
  title: textSchema,
  blobId: IdSchema,
  altText: v.string(),
  annotations: textsSchema,
});
export type ImagePayload = v.InferOutput<typeof ImagePayloadSchema>;

export const M1CardKindSchema = v.picklist([
  "question",
  "hypothesis",
  "mechanism",
  "prediction",
  "experiment",
  "observation",
  "source",
  "note",
  "frame",
  "image",
]);
export type M1CardKind = v.InferOutput<typeof M1CardKindSchema>;

/** Kind is kept in the envelope; payload cannot be validated independently of it. */
export const M1CardContentSchema = v.pipe(
  v.variant("kind", [
    v.strictObject({ kind: v.literal("question"), payload: QuestionPayloadSchema }),
    v.strictObject({ kind: v.literal("hypothesis"), payload: HypothesisPayloadSchema }),
    v.strictObject({ kind: v.literal("mechanism"), payload: MechanismPayloadSchema }),
    v.strictObject({ kind: v.literal("prediction"), payload: PredictionPayloadSchema }),
    v.strictObject({ kind: v.literal("experiment"), payload: ExperimentPayloadSchema }),
    v.strictObject({ kind: v.literal("observation"), payload: ObservationPayloadSchema }),
    v.strictObject({ kind: v.literal("source"), payload: SourcePayloadSchema }),
    v.strictObject({ kind: v.literal("note"), payload: NotePayloadSchema }),
    v.strictObject({ kind: v.literal("frame"), payload: FramePayloadSchema }),
    v.strictObject({ kind: v.literal("image"), payload: ImagePayloadSchema }),
  ]),
  v.readonly(),
);
export type M1CardContent = v.InferOutput<typeof M1CardContentSchema>;
