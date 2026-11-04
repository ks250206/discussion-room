import { evolve, validateKnownM1State, type DomainState, type Id } from "@discussion-room/domain";
import type { EventMessage, JoinedMessage, JoinMessage } from "./messages.ts";

export type Checkpoint = Readonly<{ seq: number; snapshot: DomainState }>;
export type ClientSyncState = Readonly<{
  projectId: Id;
  checkpoint: Checkpoint | null;
  phase: "ready" | "joining" | "snapshot";
}>;
type SyncStep =
  | { readonly state: ClientSyncState; readonly request?: undefined }
  | { readonly state: ClientSyncState; readonly request: JoinMessage };

export function startSync(projectId: Id, checkpoint: Checkpoint | null = null): SyncStep {
  const baseline = checkpoint?.snapshot.entities.projects[0]?.id === projectId ? checkpoint : null;
  return {
    state: { projectId, checkpoint: baseline, phase: baseline ? "joining" : "snapshot" },
    request: baseline
      ? { type: "join", projectId, lastSeq: baseline.seq }
      : { type: "join", projectId },
  };
}

function applyBatches(
  projectId: Id,
  baseline: Checkpoint,
  batches: readonly EventMessage[],
): Checkpoint | null {
  let { seq, snapshot } = baseline;
  for (const batch of batches) {
    if (batch.projectId !== projectId || batch.seq !== seq + 1) return null;
    snapshot = batch.events.reduce(evolve, snapshot);
    if (
      snapshot.entities.projects.length !== 1 ||
      snapshot.entities.projects[0]?.id !== projectId ||
      snapshot.entities.boards.some((board) => board.projectId !== projectId) ||
      snapshot.entities.artifacts.some((artifact) => artifact.projectId !== projectId) ||
      !validateKnownM1State(snapshot).ok
    )
      return null;
    seq = batch.seq;
  }
  return { seq, snapshot };
}

/** Process decoded messages in transport order, from the active socket only. */
export function receiveSync(
  state: ClientSyncState,
  message: JoinedMessage | EventMessage,
): SyncStep {
  if (message.projectId !== state.projectId) return { state };
  const { checkpoint, projectId } = state;
  if (message.type === "event") {
    if (state.phase !== "ready" || !checkpoint || message.seq <= checkpoint.seq) return { state };
    if (message.seq !== checkpoint.seq + 1) return startSync(projectId, checkpoint);
    const next = applyBatches(projectId, checkpoint, [message]);
    return next ? { state: { projectId, checkpoint: next, phase: "ready" } } : startSync(projectId);
  }

  if (state.phase === "ready") return { state };
  if (message.mode === "snapshot")
    return {
      state: {
        projectId,
        checkpoint: { seq: message.seq, snapshot: message.snapshot },
        phase: "ready",
      },
    };
  if (state.phase === "snapshot") return { state };
  const next =
    checkpoint && checkpoint.seq === message.fromSeq
      ? applyBatches(projectId, checkpoint, message.events)
      : null;
  return next?.seq === message.seq
    ? { state: { projectId, checkpoint: next, phase: "ready" } }
    : startSync(projectId);
}
