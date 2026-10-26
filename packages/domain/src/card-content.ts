import * as v from "valibot";
import { M1CardContentSchema, M1CardKindSchema, type M1CardContent } from "./card-payloads.ts";
import {
  ArtifactSchema,
  ArtifactRevisionSchema,
  OpaqueObjectSchema,
  type Artifact,
  type ArtifactRevision,
} from "./entities.ts";
import { ok, type Result } from "./result.ts";
import { validate, type ValidationError } from "./validation.ts";

const envelopeSchema = v.pipe(
  v.strictObject({
    kind: v.pipe(
      v.string(),
      v.check((kind) => kind.trim().length > 0, "Expected nonblank kind"),
    ),
    payload: OpaqueObjectSchema,
  }),
  v.readonly(),
);
export type CardContent = v.InferOutput<typeof envelopeSchema>;

/** Strict for known M1 kinds; preserve future kinds as opaque objects, without certification. */
export function validateCardContent(input: unknown): Result<CardContent, ValidationError> {
  const envelope = validate(envelopeSchema, input);
  if (!envelope.ok) return envelope;
  if (!v.is(M1CardKindSchema, envelope.value.kind)) return envelope;
  return validate(M1CardContentSchema, envelope.value);
}

/** Opaque-compatible boundary: unrecognized kinds receive structural checks only. */
export function validateArtifactContent(input: unknown): Result<Artifact, ValidationError> {
  const artifact = validate(ArtifactSchema, input);
  if (!artifact.ok) return artifact;
  const content = validateCardContent({
    kind: artifact.value.kind,
    payload: artifact.value.payload,
  });
  return content.ok ? ok({ ...artifact.value, payload: content.value.payload }) : content;
}

/** Opaque-compatible revision checks; the owning Artifact supplies kind. Not an M1 save gate. */
export function validateRevisionContent(
  kind: string,
  input: unknown,
): Result<ArtifactRevision, ValidationError> {
  const revision = validate(ArtifactRevisionSchema, input);
  if (!revision.ok) return revision;
  const content = validateCardContent({ kind, payload: revision.value.payload });
  return content.ok ? ok({ ...revision.value, payload: content.value.payload }) : content;
}

/** An Artifact whose kind and payload have passed strict M1 validation. */
export type M1Artifact = Readonly<Omit<Artifact, "kind" | "payload"> & M1CardContent>;

/** A Revision with a validated M1 payload, without adding kind to the stored entity. */
export type M1ArtifactRevision = Readonly<
  Omit<ArtifactRevision, "payload"> & { readonly payload: M1CardContent["payload"] }
>;

/** M1 content gate: unknown, misspelled and padded kinds fail without normalization. */
export function validateM1ArtifactContent(input: unknown): Result<M1Artifact, ValidationError> {
  const artifact = validate(ArtifactSchema, input);
  if (!artifact.ok) return artifact;
  const content = validate(M1CardContentSchema, {
    kind: artifact.value.kind,
    payload: artifact.value.payload,
  });
  return content.ok ? ok({ ...artifact.value, ...content.value }) : content;
}

/** Strict M1 revision gate; kind must come from the owning Artifact, never from the caller's guess. */
export function validateM1RevisionContent(
  kind: unknown,
  input: unknown,
): Result<M1ArtifactRevision, ValidationError> {
  const revision = validate(ArtifactRevisionSchema, input);
  if (!revision.ok) return revision;
  const content = validate(M1CardContentSchema, { kind, payload: revision.value.payload });
  return content.ok ? ok({ ...revision.value, payload: content.value.payload }) : content;
}
