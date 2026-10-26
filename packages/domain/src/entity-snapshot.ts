import { EntitySnapshotSchema, type ArtifactRevision, type EntitySnapshot } from "./entities.ts";
import type { Id } from "./id.ts";
import { err, ok, type Result } from "./result.ts";
import { validate, type ValidationError } from "./validation.ts";

export type EntityReferenceIssue = {
  readonly code:
    | "duplicate_id"
    | "missing_reference"
    | "project_mismatch"
    | "revision_owner_mismatch"
    | "revision_cycle";
  readonly collection: keyof EntitySnapshot;
  readonly id: Id;
  readonly field: string;
  readonly referenceId: Id;
};

export type EntityReferenceError = {
  readonly code: "reference_integrity_failed";
  readonly issues: readonly EntityReferenceIssue[];
};

/** Each revision has at most one parent; check every lineage, including detached history. */
function findRevisionCycles(revisions: readonly ArtifactRevision[]): EntityReferenceIssue[] {
  const byId = new Map(revisions.map((revision) => [revision.id, revision]));
  const complete = new Set<Id>();
  const issues: EntityReferenceIssue[] = [];
  for (const revision of revisions) {
    const path = new Set<Id>();
    let current: ArtifactRevision | undefined = revision;
    while (current && !complete.has(current.id)) {
      path.add(current.id);
      const parentId: Id | undefined = current.parentId;
      if (parentId !== undefined && path.has(parentId)) {
        issues.push({
          code: "revision_cycle",
          collection: "revisions",
          id: current.id,
          field: "parentId",
          referenceId: parentId,
        });
        break;
      }
      current = parentId === undefined ? undefined : byId.get(parentId);
    }
    for (const id of path) complete.add(id);
  }
  return issues;
}

/**
 * Validate shape and references, not current payload agreement or approval.
 * The apply layer must maintain Artifact.payload from its authored current revision.
 */
export function validateEntitySnapshot(
  input: unknown,
): Result<EntitySnapshot, ValidationError | EntityReferenceError> {
  const parsed = validate(EntitySnapshotSchema, input);
  if (!parsed.ok) return parsed;
  const snapshot = parsed.value;
  const issues: EntityReferenceIssue[] = [];
  for (const collection of [
    "projects",
    "boards",
    "artifacts",
    "revisions",
    "canvasItems",
  ] as const) {
    const seen = new Set<Id>();
    for (const entity of snapshot[collection]) {
      if (seen.has(entity.id)) {
        issues.push({
          code: "duplicate_id",
          collection,
          id: entity.id,
          field: "id",
          referenceId: entity.id,
        });
      }
      seen.add(entity.id);
    }
  }
  // Ambiguous IDs must not be resolved by silently picking a duplicate.
  if (issues.length > 0) return err({ code: "reference_integrity_failed", issues });

  const projects = new Set(snapshot.projects.map((project) => project.id));
  const boards = new Map(snapshot.boards.map((board) => [board.id, board]));
  const artifacts = new Map(snapshot.artifacts.map((artifact) => [artifact.id, artifact]));
  const revisions = new Map(snapshot.revisions.map((revision) => [revision.id, revision]));
  const add = (
    code: EntityReferenceIssue["code"],
    collection: keyof EntitySnapshot,
    id: Id,
    field: string,
    referenceId: Id,
  ) => issues.push({ code, collection, id, field, referenceId });

  for (const board of snapshot.boards) {
    if (!projects.has(board.projectId))
      add("missing_reference", "boards", board.id, "projectId", board.projectId);
  }
  for (const artifact of snapshot.artifacts) {
    if (!projects.has(artifact.projectId))
      add("missing_reference", "artifacts", artifact.id, "projectId", artifact.projectId);
    const revision = revisions.get(artifact.revisionId);
    if (!revision)
      add("missing_reference", "artifacts", artifact.id, "revisionId", artifact.revisionId);
    else if (revision.artifactId !== artifact.id)
      add("revision_owner_mismatch", "artifacts", artifact.id, "revisionId", revision.id);
  }
  for (const revision of snapshot.revisions) {
    if (!artifacts.has(revision.artifactId))
      add("missing_reference", "revisions", revision.id, "artifactId", revision.artifactId);
    if (revision.parentId === undefined) continue;
    const parent = revisions.get(revision.parentId);
    if (!parent) add("missing_reference", "revisions", revision.id, "parentId", revision.parentId);
    else if (parent.artifactId !== revision.artifactId)
      add("revision_owner_mismatch", "revisions", revision.id, "parentId", parent.id);
  }
  for (const item of snapshot.canvasItems) {
    const board = boards.get(item.boardId);
    if (!board) add("missing_reference", "canvasItems", item.id, "boardId", item.boardId);
    if (item.artifactId === undefined) continue;
    const artifact = artifacts.get(item.artifactId);
    if (!artifact) add("missing_reference", "canvasItems", item.id, "artifactId", item.artifactId);
    else if (board && artifact.projectId !== board.projectId)
      add("project_mismatch", "canvasItems", item.id, "artifactId", artifact.id);
  }
  issues.push(...findRevisionCycles(snapshot.revisions));
  return issues.length > 0 ? err({ code: "reference_integrity_failed", issues }) : ok(snapshot);
}

export type CanvasItemNotFoundError = {
  readonly code: "canvas_item_not_found";
  readonly id: Id;
};

/** Remove only a placement. Artifacts and their revision history remain shared. */
export function removeCanvasItem(
  snapshot: EntitySnapshot,
  id: Id,
): Result<EntitySnapshot, CanvasItemNotFoundError> {
  if (!snapshot.canvasItems.some((item) => item.id === id))
    return err({ code: "canvas_item_not_found", id });
  return ok({ ...snapshot, canvasItems: snapshot.canvasItems.filter((item) => item.id !== id) });
}
