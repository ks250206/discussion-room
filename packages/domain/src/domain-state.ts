import { validateM1ArtifactContent, validateM1RevisionContent } from "./card-content.ts";
import { M1CardContentSchema, type M1CardContent } from "./card-payloads.ts";
import type { DomainState } from "./commands.ts";
import type { Artifact, ArtifactRevision } from "./entities.ts";
import type { EntityReferenceError } from "./entity-snapshot.ts";
import { validateGraphSnapshot, type GraphReferenceError } from "./graph-validation.ts";
import type { Id } from "./id.ts";
import { compareTimestamps, type ChronologyError } from "./timestamp-order.ts";
import { err, ok, type Result } from "./result.ts";
import { validate, type ValidationError } from "./validation.ts";

export type CommandError = {
  readonly code:
    | "not_found"
    | "version_conflict"
    | "id_conflict"
    | "invalid_context"
    | "content_integrity_failed"
    | "payload_reference_failed"
    | "ai_approval_required"
    | "ai_origin_changed"
    | "ai_origin_unsupported"
    | "registration_invalid"
    | "immutable_field";
  readonly message: string;
  readonly id?: Id;
  readonly field?: string;
  readonly referenceId?: Id;
  readonly currentVersion?: number;
  readonly baseVersion?: number;
};
export type DomainError =
  | ValidationError
  | EntityReferenceError
  | GraphReferenceError
  | CommandError
  | ChronologyError;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exact structural equality for schema-validated M1 content; no JSON coercion or unit normalization. */
export function equalContent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null)
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value: unknown, index: number) => equalContent(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const a = left;
  const b = right;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equalContent(a[key], b[key]))
  );
}

function validateReferences(
  artifacts: ReadonlyMap<Id, Artifact>,
  artifact: Artifact,
  content: M1CardContent,
): Result<undefined, CommandError> {
  const refs: { readonly id: Id; readonly field: string; readonly kind?: string }[] = [];
  const add = (ids: readonly Id[], field: string, kind?: string) => {
    for (const id of ids) refs.push({ id, field, ...(kind === undefined ? {} : { kind }) });
  };
  switch (content.kind) {
    case "hypothesis":
    case "experiment":
      add(content.payload.predictionIds, "predictionIds", "prediction");
      break;
    case "prediction":
      for (const rule of content.payload.registration.rules) {
        add(rule.supportsHypothesisIds, "registration.rules.supportsHypothesisIds", "hypothesis");
        add(
          rule.challengesHypothesisIds,
          "registration.rules.challengesHypothesisIds",
          "hypothesis",
        );
      }
      break;
    case "observation":
      add(content.payload.sourceIds, "sourceIds", "source");
      // No code card validator exists in M1: do not bless an opaque future kind.
      add(content.payload.analysisCodeIds, "analysisCodeIds", "python");
      break;
    case "frame":
      add(content.payload.artifactIds, "artifactIds");
      break;
    case "question":
    case "mechanism":
    case "source":
    case "note":
    case "image":
      break;
  }
  if (content.payload.provenance) add(content.payload.provenance.sourceIds, "provenance.sourceIds");
  for (const ref of refs) {
    const target = artifacts.get(ref.id);
    if (
      !target ||
      target.projectId !== artifact.projectId ||
      (ref.kind !== undefined && target.kind !== ref.kind)
    )
      return err({
        code: "payload_reference_failed",
        message: "Expected an existing Artifact of the declared kind in the same Project",
        id: artifact.id,
        field: ref.field,
        referenceId: ref.id,
      });
  }
  return ok(undefined);
}

/** Edits must retain AI origin and must not silently carry an old preregistration onto new content. */
export function validateContentTransition(
  before: M1CardContent | undefined,
  after: M1CardContent,
  revision: ArtifactRevision,
  parent: ArtifactRevision | undefined,
): Result<undefined, CommandError | ChronologyError> {
  const order = compareTimestamps(revision.createdAt, parent?.createdAt ?? revision.createdAt);
  if (!order.ok) return order;
  if (order.value < 0)
    return err({
      code: "content_integrity_failed",
      message: "Revision predates its parent",
      id: revision.id,
      field: "createdAt",
    });
  if (
    before?.payload.generatedBy === "ai" &&
    (after.payload.generatedBy !== "ai" ||
      !equalContent(before.payload.provenance, after.payload.provenance))
  )
    return err({
      code: "ai_origin_changed",
      message: "AI origin, model and generation record must survive editing and approval",
      id: revision.artifactId,
      field: "provenance",
    });
  if (after.kind !== "prediction" || after.payload.registration.status !== "registered")
    return ok(undefined);
  const registration = after.payload.registration;
  const registrationOrder = compareTimestamps(registration.registeredAt, revision.createdAt);
  if (!registrationOrder.ok) return registrationOrder;
  if (registrationOrder.value > 0)
    return err({
      code: "registration_invalid",
      message: "Registration cannot postdate its recorded revision",
      id: revision.artifactId,
      field: "registration.registeredAt",
    });
  if (before?.kind === "prediction" && equalContent(before.payload, after.payload))
    return ok(undefined);
  // A new/changed registered prediction records who registered this exact content, now.
  if (registrationOrder.value !== 0 || registration.registeredBy !== revision.author)
    return err({
      code: "registration_invalid",
      message:
        "Register changed content at this revision's timestamp and actor, or save it as draft",
      id: revision.artifactId,
      field: "registration",
    });
  return ok(undefined);
}

/** Strong M1 boundary used before deciding and after the complete atomic event batch. */
export function validateDomainState(input: unknown): Result<DomainState, DomainError> {
  const graph = validateGraphSnapshot(input);
  if (!graph.ok) return graph;
  const state = graph.value;
  const revisions = new Map(state.entities.revisions.map((revision) => [revision.id, revision]));
  const artifacts = new Map(state.entities.artifacts.map((artifact) => [artifact.id, artifact]));
  const revisionsByArtifact = new Map<Id, ArtifactRevision[]>();
  for (const revision of state.entities.revisions) {
    const group = revisionsByArtifact.get(revision.artifactId);
    if (group) group.push(revision);
    else revisionsByArtifact.set(revision.artifactId, [revision]);
  }
  for (const artifact of state.entities.artifacts) {
    const valid = validateM1ArtifactContent(artifact);
    if (!valid.ok) return valid;
    const current = revisions.get(artifact.revisionId);
    if (!current || !equalContent(artifact.payload, current.payload))
      return err({
        code: "content_integrity_failed",
        message: "Artifact cache differs from its authored current Revision",
        id: artifact.id,
        field: "payload",
      });
    for (const revision of revisionsByArtifact.get(artifact.id) ?? []) {
      const validRevision = validateM1RevisionContent(artifact.kind, revision);
      if (!validRevision.ok) return validRevision;
      const content = validate(M1CardContentSchema, {
        kind: artifact.kind,
        payload: revision.payload,
      });
      if (!content.ok) return content;
      const references = validateReferences(artifacts, artifact, content.value);
      if (!references.ok) return references;
      const parent = revision.parentId === undefined ? undefined : revisions.get(revision.parentId);
      const previous =
        parent === undefined
          ? undefined
          : validate(M1CardContentSchema, { kind: artifact.kind, payload: parent.payload });
      if (previous && !previous.ok) return previous;
      const transition = validateContentTransition(
        previous?.value,
        content.value,
        revision,
        parent,
      );
      if (!transition.ok) return transition;
    }
  }
  return ok(state);
}
