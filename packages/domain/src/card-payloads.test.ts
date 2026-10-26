import * as v from "valibot";
import { assert, describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  ExperimentPayloadSchema,
  FramePayloadSchema,
  HypothesisPayloadSchema,
  HypothesisStatusSchema,
  ImagePayloadSchema,
  M1CardContentSchema,
  M1CardKindSchema,
  MeasurementConditionsSchema,
  MechanismPayloadSchema,
  NotePayloadSchema,
  ObservationPayloadSchema,
  PredictionPayloadSchema,
  QuestionPayloadSchema,
  SourcePayloadSchema,
  validate,
  validateArtifactContent,
  validateCardContent,
  validateM1ArtifactContent,
  validateM1RevisionContent,
  validateRevisionContent,
  type ExpectedObservation,
  type HypothesisPayload,
  type M1Artifact,
  type M1ArtifactRevision,
  type M1CardContent,
  type M1CardKind,
  type ObservationPayload,
  type PredictionPayload,
  type ScientificCondition,
  type ScientificQuantity,
} from "./index.ts";

const id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const otherId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const timestamp = "2026-10-26T12:34:56.0012300+09:00";
const common = { title: "圧力と界面抵抗", author: " 研究者 A ", generatedBy: "human" };
const quantity = { value: 10, unit: "MPa", uncertainty: 0.1, significantFigures: 3 };
const condition = { name: "pressure", value: { type: "quantity", quantity } };
const rule = {
  outcome: "Pressure decreases interface resistance",
  supportsHypothesisIds: [id],
  challengesHypothesisIds: [otherId],
  rationale: "Distinguishes the preregistered contact and chemical explanations",
};
const prediction = {
  ...common,
  applicability: ["298 K, otherwise identical cells"],
  interventionFactors: [condition],
  fixedFactors: [{ name: "temperature", value: { type: "unknown", reason: "Not recorded yet" } }],
  expectedObservations: [
    { type: "qualitative", observable: "interface resistance", description: "decreases" },
    { type: "quantitative", observable: "pressure", quantity },
  ],
  registration: {
    status: "registered",
    registeredAt: timestamp,
    registeredBy: "Researcher",
    rules: [rule],
  },
};
const observation = {
  ...common,
  observations: [{ observable: "pressure", quantity }],
  measurementConditions: { status: "unknown", reason: "Instrument log unavailable" },
  sourceIds: [],
  analysisCodeIds: [],
};
const aiProvenance = {
  id,
  originType: "ai",
  sourceIds: [],
  createdBy: "Research assistant",
  method: "Generation from selected research context",
  timestamp,
  generatedBy: "ai",
  modelId: "recorded-model-id",
};

const examples: readonly {
  readonly kind: M1CardKind;
  readonly schema: v.GenericSchema;
  readonly payload: Readonly<Record<string, unknown>>;
}[] = [
  {
    kind: "question",
    schema: QuestionPayloadSchema,
    payload: { ...common, question: "What limits transport?", objectives: [], constraints: [] },
  },
  {
    kind: "hypothesis",
    schema: HypothesisPayloadSchema,
    payload: {
      ...common,
      statement: "Contact limits transport",
      applicability: [],
      refutationCriteria: ["No change under controlled pressure"],
      status: "proposed",
      tags: [],
      predictionIds: [],
    },
  },
  {
    kind: "mechanism",
    schema: MechanismPayloadSchema,
    payload: {
      ...common,
      explanation: "Pressure changes contact area",
      applicability: [],
      assumptions: [],
    },
  },
  { kind: "prediction", schema: PredictionPayloadSchema, payload: prediction },
  {
    kind: "experiment",
    schema: ExperimentPayloadSchema,
    payload: {
      ...common,
      objective: "Compare contact and chemical contributions",
      protocol: "Measure EIS at each recorded pressure",
      controls: ["Unchanged specimen"],
      conditions: [condition],
      predictionIds: [],
      decisionCriteria: ["Evaluate against the registered predictions"],
    },
  },
  { kind: "observation", schema: ObservationPayloadSchema, payload: observation },
  {
    kind: "source",
    schema: SourcePayloadSchema,
    payload: {
      ...common,
      sourceType: "instrument-log",
      reference: "Original log attachment",
      description: "",
    },
  },
  { kind: "note", schema: NotePayloadSchema, payload: { ...common, markdown: "# Notes\n" } },
  {
    kind: "frame",
    schema: FramePayloadSchema,
    payload: { ...common, description: "Comparison", artifactIds: [id] },
  },
  {
    kind: "image",
    schema: ImagePayloadSchema,
    payload: { ...common, blobId: id, altText: "EIS plot", annotations: [] },
  },
];

describe("M1 card payload boundaries", () => {
  test("covers exactly the ten M1 kinds", () => {
    expect(examples.map(({ kind }) => kind)).toEqual(M1CardKindSchema.options);
  });

  test.each(examples)(
    "validates $kind without changing authored content",
    ({ kind, schema, payload }) => {
      expect(validate(schema, payload)).toEqual({ ok: true, value: payload });
      expect(validate(M1CardContentSchema, { kind, payload })).toEqual({
        ok: true,
        value: { kind, payload },
      });
      expect(payload.author).toBe(common.author);
      expect(Object.isFrozen(payload)).toBe(false);
    },
  );

  test.each(examples)(
    "requires every $kind field with no missing-value defaults",
    ({ schema, payload }) => {
      for (const key of Object.keys(payload)) {
        const missing = { ...payload };
        delete missing[key];
        expect(validate(schema, missing).ok, `missing ${key}`).toBe(false);
        for (const invalid of [undefined, null]) {
          expect(validate(schema, { ...payload, [key]: invalid }).ok, `invalid ${key}`).toBe(false);
        }
      }
      for (const invalid of [undefined, null, [], 1, "payload"]) {
        expect(validate(schema, invalid).ok).toBe(false);
      }
    },
  );

  test.each(examples)(
    "rejects wrong kind and extra $kind fields rather than stripping them",
    ({ kind, schema, payload }) => {
      const wrongKind = kind === "note" ? "image" : "note";
      expect(validate(M1CardContentSchema, { kind: wrongKind, payload }).ok).toBe(false);
      expect(validate(schema, { ...payload, approval: "approved" }).ok).toBe(false);
      expect(validate(M1CardContentSchema, { kind, payload, provenance: aiProvenance }).ok).toBe(
        false,
      );
      expect(validate(schema, { ...payload, author: " \t " }).ok).toBe(false);
      expect(validate(schema, { ...payload, generatedBy: "unknown" }).ok).toBe(false);
    },
  );

  test.each(examples)(
    "retains AI origin in $kind after human editorial activity",
    ({ kind, schema, payload }) => {
      const aiPayload = {
        ...payload,
        generatedBy: "ai",
        author: "Research assistant",
        provenance: aiProvenance,
      };
      expect(validate(schema, aiPayload)).toEqual({ ok: true, value: aiPayload });
      expect(validateCardContent({ kind, payload: aiPayload }).ok).toBe(true);
      expect(validate(schema, { ...payload, generatedBy: "ai" }).ok).toBe(false);
      expect(validate(schema, { ...aiPayload, generatedBy: "human" }).ok).toBe(false);
      expect(
        validate(schema, { ...aiPayload, provenance: { ...aiProvenance, modelId: " " } }).ok,
      ).toBe(false);
      expect(
        validate(schema, { ...aiPayload, provenance: { ...aiProvenance, timestamp: "yesterday" } })
          .ok,
      ).toBe(false);
      const { generatedBy: _generatedBy, modelId: _modelId, ...manual } = aiProvenance;
      expect(
        validate(schema, { ...aiPayload, provenance: { ...manual, originType: "manual" } }).ok,
      ).toBe(false);
      expect(
        validate(schema, { ...payload, provenance: { ...manual, originType: "manual" } }).ok,
      ).toBe(true);
      expect(validate(schema, { ...payload, provenance: undefined }).ok).toBe(false);
    },
  );

  test("accepts all descriptive hypothesis states and never proven", () => {
    const example = examples.find(({ kind }) => kind === "hypothesis");
    assert(example !== undefined);
    for (const status of HypothesisStatusSchema.options) {
      expect(validate(HypothesisPayloadSchema, { ...example.payload, status }).ok).toBe(true);
    }
    for (const status of ["proven", "accepted", "certain", null, ""]) {
      expect(validate(HypothesisPayloadSchema, { ...example.payload, status }).ok).toBe(false);
    }
  });

  test("rejects malformed kind-specific contents", () => {
    const invalidFields: Record<M1CardKind, Readonly<Record<string, unknown>>> = {
      question: { constraints: [1] },
      hypothesis: { predictionIds: ["not-an-id"] },
      mechanism: { explanation: " " },
      prediction: { expectedObservations: [] },
      experiment: { protocol: " " },
      observation: { observations: [] },
      source: { sourceType: "verified-fact" },
      note: { markdown: 42 },
      frame: { artifactIds: ["not-an-id"] },
      image: { blobId: "not-an-id" },
    };
    for (const { kind, schema, payload } of examples) {
      expect(validate(schema, { ...payload, ...invalidFields[kind] }).ok).toBe(false);
    }
  });
});

describe("prediction and observation scientific integrity", () => {
  test("records draft versus registered rules with explicit registration actor and time", () => {
    const draft = { ...prediction, registration: { status: "draft", rules: [] } };
    expect(validate(PredictionPayloadSchema, draft).ok).toBe(true);
    for (const registration of [
      { status: "registered", rules: [rule] },
      { ...prediction.registration, rules: [] },
      { ...prediction.registration, registeredBy: " " },
      { ...prediction.registration, registeredAt: "2026-02-30T00:00:00Z" },
      {
        ...prediction.registration,
        rules: [{ ...rule, supportsHypothesisIds: [], challengesHypothesisIds: [] }],
      },
      { ...prediction.registration, rules: [{ ...rule, challengesHypothesisIds: [id] }] },
      { ...prediction.registration, rules: [{ ...rule, outcome: " " }] },
      { ...prediction.registration, approved: true },
      { status: "draft", rules: [], registeredAt: timestamp },
    ]) {
      expect(validate(PredictionPayloadSchema, { ...prediction, registration }).ok).toBe(false);
    }
  });

  test("preserves qualitative and numeric predictions, conditions, units and precision", () => {
    const parsed = validate(PredictionPayloadSchema, {
      ...prediction,
      model: "Explicit user model",
    });
    assert(parsed.ok);
    expect(parsed.value.expectedObservations).toEqual(prediction.expectedObservations);
    expect(parsed.value.interventionFactors).toEqual(prediction.interventionFactors);
    expect(parsed.value.fixedFactors).toEqual(prediction.fixedFactors);
    expect(validate(PredictionPayloadSchema, { ...prediction, model: undefined }).ok).toBe(false);
    const numeric = {
      type: "quantitative",
      observable: "conductivity",
      quantity: { value: 2, unit: "custom-unit" },
    };
    expect(
      validate(PredictionPayloadSchema, { ...prediction, expectedObservations: [numeric] }).ok,
    ).toBe(true);
    expect(
      validate(PredictionPayloadSchema, {
        ...prediction,
        expectedObservations: [{ ...numeric, description: "a separate interpretation" }],
      }).ok,
    ).toBe(false);
    expect(
      validate(PredictionPayloadSchema, {
        ...prediction,
        interventionFactors: [{ ...condition, value: { type: "unknown", reason: " " } }],
      }).ok,
    ).toBe(false);
  });

  test("uses explicit unknown conditions without substituting zero, room temperature or units", () => {
    const parsed = validate(ObservationPayloadSchema, observation);
    assert(parsed.ok);
    expect(parsed.value).toEqual(observation);
    expect(parsed.value.measurementConditions).toEqual({
      status: "unknown",
      reason: "Instrument log unavailable",
    });
    const known = {
      status: "known",
      values: [
        condition,
        { name: "temperature", value: { type: "unknown", reason: "Not recorded" } },
        { name: "atmosphere", value: { type: "qualitative", description: "Argon" } },
      ],
    };
    expect(validate(MeasurementConditionsSchema, known).ok).toBe(true);
    for (const measurementConditions of [
      "unknown",
      {},
      null,
      undefined,
      { status: "unknown", reason: " " },
      { status: "unknown", reason: "Missing", values: [] },
      { status: "known", values: [] },
      {
        status: "known",
        values: [{ name: "temperature", value: { type: "quantity", quantity: { value: 25 } } }],
      },
    ]) {
      expect(validate(ObservationPayloadSchema, { ...observation, measurementConditions }).ok).toBe(
        false,
      );
    }
  });

  test("rejects invalid quantities in observations, predictions and factor conditions", () => {
    for (const invalid of [
      {},
      { value: null, unit: "MPa" },
      { value: 10 },
      { value: 10, unit: "" },
      { value: Number.NaN, unit: "MPa" },
      { value: Infinity, unit: "MPa" },
      { value: "10", unit: "MPa" },
      { value: -1, unit: "K" },
      { value: 1, unit: "MPa", uncertaintyType: "sd" },
      { value: 1, unit: "MPa", uncertainty: -1 },
      { value: 1, unit: "MPa", significantFigures: 0 },
      { value: 1, unit: "MPa", normalization: "implicit" },
    ]) {
      expect(
        validate(ObservationPayloadSchema, {
          ...observation,
          observations: [{ observable: "pressure", quantity: invalid }],
        }).ok,
      ).toBe(false);
      expect(
        validate(PredictionPayloadSchema, {
          ...prediction,
          expectedObservations: [
            { type: "quantitative", observable: "pressure", quantity: invalid },
          ],
        }).ok,
      ).toBe(false);
      expect(
        validate(PredictionPayloadSchema, {
          ...prediction,
          fixedFactors: [{ name: "pressure", value: { type: "quantity", quantity: invalid } }],
        }).ok,
      ).toBe(false);
    }
  });

  test("retains optional source hash and analysis references, without adding an interpretation", () => {
    const withSources = {
      ...observation,
      sourceFileHash: { algorithm: "sha256", digest: "a".repeat(64) },
      sourceIds: [id],
      analysisCodeIds: [otherId],
    };
    expect(validate(ObservationPayloadSchema, withSources)).toEqual({
      ok: true,
      value: withSources,
    });
    for (const sourceFileHash of [
      undefined,
      { algorithm: "sha1", digest: "a".repeat(64) },
      { algorithm: "sha256", digest: "unknown" },
      { algorithm: "sha256", digest: "g".repeat(64) },
    ]) {
      expect(validate(ObservationPayloadSchema, { ...observation, sourceFileHash }).ok).toBe(false);
    }
    for (const extra of [{ evidencePolarity: "supports" }, { hypothesisStatus: "proven" }]) {
      expect(validate(ObservationPayloadSchema, { ...observation, ...extra }).ok).toBe(false);
    }
  });
});

function artifact(kind: string, payload: unknown) {
  return { id, projectId: otherId, kind, payload, revisionId: otherId, version: 1 };
}
function revision(payload: unknown) {
  return {
    id: otherId,
    artifactId: id,
    payload,
    author: "Human editor accepting the AI proposal",
    createdAt: timestamp,
    version: 1,
  };
}

describe("content boundary integration", () => {
  test.each(examples)(
    "validates $kind payloads in Artifact and authored Revision envelopes",
    ({ kind, payload }) => {
      expect(validateArtifactContent(artifact(kind, payload)).ok).toBe(true);
      expect(validateRevisionContent(kind, revision(payload)).ok).toBe(true);
      expect(validateM1ArtifactContent(artifact(kind, payload)).ok).toBe(true);
      expect(validateM1RevisionContent(kind, revision(payload)).ok).toBe(true);
      const invalid = { ...payload, generatedBy: "ai" };
      expect(validateArtifactContent(artifact(kind, invalid)).ok).toBe(false);
      expect(validateRevisionContent(kind, revision(invalid)).ok).toBe(false);
      expect(validateM1ArtifactContent(artifact(kind, invalid)).ok).toBe(false);
      expect(validateM1RevisionContent(kind, revision(invalid)).ok).toBe(false);
      const result = validateArtifactContent(artifact(kind, invalid));
      assert(!result.ok);
      expect(result.error.code).toBe("validation_failed");
      expect(result.error.issues[0].path?.[0]?.key).toBe("payload");
    },
  );

  test("does not confuse revision editor with retained AI origin or infer approval", () => {
    const payload = {
      ...observation,
      author: "AI assistant",
      generatedBy: "ai",
      provenance: aiProvenance,
    };
    const parsed = validateM1RevisionContent("observation", revision(payload));
    assert(parsed.ok);
    expect(parsed.value.author).toBe("Human editor accepting the AI proposal");
    expect(parsed.value.payload).toEqual(payload);
    expect(parsed.value.createdAt).toBe(timestamp);
    expect(parsed.value.payload).not.toHaveProperty("approved");
  });

  test("preserves future opaque payloads verbatim while rejecting malformed envelopes", () => {
    const payload = {
      futureField: [null, { unknown: true }],
      provenance: { futureOrigin: "unmodeled" },
    };
    const parsed = validateArtifactContent(artifact("future-card", payload));
    assert(parsed.ok);
    expect(parsed.value.payload).toBe(payload);
    expect(validateRevisionContent("future-card", revision(payload)).ok).toBe(true);
    expect(validate(M1CardContentSchema, { kind: "future-card", payload }).ok).toBe(false);
    for (const kind of ["", " ", null, undefined]) {
      expect(validateCardContent({ kind, payload }).ok).toBe(false);
    }
    for (const invalid of [null, [], "payload"]) {
      expect(validateArtifactContent(artifact("future-card", invalid)).ok).toBe(false);
    }
    expect(validateArtifactContent({ ...artifact("note", {}), revisionId: "bad-id" }).ok).toBe(
      false,
    );
    expect(validateRevisionContent("note", { ...revision({}), author: " " }).ok).toBe(false);
  });

  test("strict M1 gates reject opaque, wrong-case and padded kinds without certifying them", () => {
    for (const kind of ["future-card", "Hypothesis", "hypothesis ", " hypothesis", "evidence"]) {
      const payload = { status: "proven" };
      const opaque = validateArtifactContent(artifact(kind, payload));
      assert(opaque.ok);
      expect(opaque.value.payload).toBe(payload);
      expect(validateRevisionContent(kind, revision(payload)).ok).toBe(true);
      expect(validateM1ArtifactContent(artifact(kind, payload)).ok).toBe(false);
      const strictRevision = validateM1RevisionContent(kind, revision(payload));
      assert(!strictRevision.ok);
      expect(strictRevision.error.issues[0].path?.[0]?.key).toBe("kind");
      // Even a valid hypothesis payload cannot make an unrecognized spelling an M1 kind.
      const hypothesis = examples.find((example) => example.kind === "hypothesis");
      assert(hypothesis !== undefined);
      expect(validateM1ArtifactContent(artifact(kind, hypothesis.payload)).ok).toBe(false);
    }
    for (const kind of [undefined, null, "", " ", 42]) {
      expect(validateM1ArtifactContent(artifact(String(kind), {})).ok).toBe(false);
      expect(validateM1RevisionContent(kind, revision({})).ok).toBe(false);
    }
  });

  test("strict results expose validated M1 payload types without changing the revision envelope", () => {
    const parsedArtifact = validateM1ArtifactContent(artifact("prediction", prediction));
    const parsedRevision = validateM1RevisionContent("prediction", revision(prediction));
    assert(parsedArtifact.ok && parsedRevision.ok);
    expectTypeOf(parsedArtifact.value).toEqualTypeOf<M1Artifact>();
    expectTypeOf(parsedRevision.value).toEqualTypeOf<M1ArtifactRevision>();
    assert(parsedArtifact.value.kind === "prediction");
    expectTypeOf(parsedArtifact.value.payload).toEqualTypeOf<PredictionPayload>();
    expect(parsedArtifact.value.payload.registration).toEqual(prediction.registration);
    expectTypeOf<M1ArtifactRevision>().toEqualTypeOf<Readonly<M1ArtifactRevision>>();
    expect(parsedRevision.value).toEqual(revision(prediction));
    expect(parsedRevision.value).not.toHaveProperty("kind");
  });

  test("exports readonly discriminated payload types including nested structures", () => {
    expectTypeOf<M1CardContent>().toEqualTypeOf<Readonly<M1CardContent>>();
    expectTypeOf<HypothesisPayload>().toEqualTypeOf<Readonly<HypothesisPayload>>();
    expectTypeOf<HypothesisPayload["applicability"]>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<PredictionPayload["expectedObservations"]>().toEqualTypeOf<
      readonly ExpectedObservation[]
    >();
    expectTypeOf<PredictionPayload["interventionFactors"]>().toEqualTypeOf<
      readonly ScientificCondition[]
    >();
    expectTypeOf<
      ObservationPayload["observations"][number]["quantity"]
    >().toEqualTypeOf<ScientificQuantity>();
    const parsed = validate(M1CardContentSchema, { kind: "prediction", payload: prediction });
    assert(parsed.ok && parsed.value.kind === "prediction");
    expectTypeOf(parsed.value.payload).toEqualTypeOf<PredictionPayload>();
    if (parsed.value.payload.generatedBy === "ai") {
      expectTypeOf(parsed.value.payload.provenance).not.toBeNullable();
    }
  });
});
