import { ok, type DomainState, type Result } from "@discussion-room/domain";
import {
  PROTOCOL_LIMITS,
  encodeServerMessage,
  type JoinMessage,
  type Member,
  type ProtocolError,
} from "@discussion-room/protocol";
import type { Repository, RepositoryError, StoredEvent } from "./models.ts";

/** Replay eligibility only. The durable event and audit logs are retained. */
export const RESUME_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

function wireEvent(event: StoredEvent) {
  return {
    type: "event",
    seq: event.seq,
    projectId: event.projectId,
    actor: event.actor,
    commandId: event.commandId,
    events: event.payload.events,
  };
}

/** Encode a join reply at the sequence of one atomic repository read. */
export function readJoinReply(
  repository: Repository,
  join: JoinMessage,
  members: readonly Member[],
  nowMs = Date.now(),
): Result<{ wire: string; graph: DomainState } | null, RepositoryError | ProtocolError> {
  const { projectId, lastSeq } = join;
  const read = repository.readProjectForResume(
    projectId,
    lastSeq,
    PROTOCOL_LIMITS.maxResumeBatches,
  );
  if (!read.ok) return read;
  if (!read.value) return ok(null);

  const { seq, state, events } = read.value;
  const header = { type: "joined", projectId, seq, members };
  if (
    lastSeq !== undefined &&
    events?.every((event) => Date.parse(event.createdAt) >= nowMs - RESUME_RETENTION_MS)
  ) {
    const replay = encodeServerMessage({
      ...header,
      mode: "events",
      fromSeq: lastSeq,
      events: events.map(wireEvent),
    });
    if (replay.ok) return ok({ wire: replay.value, graph: state.graph });
  }

  const snapshot = encodeServerMessage({ ...header, mode: "snapshot", snapshot: state.graph });
  return snapshot.ok ? ok({ wire: snapshot.value, graph: state.graph }) : snapshot;
}

export function encodeJoinReply(
  repository: Repository,
  join: JoinMessage,
  members: readonly Member[],
  nowMs = Date.now(),
): Result<string | null, RepositoryError | ProtocolError> {
  const reply = readJoinReply(repository, join, members, nowMs);
  return reply.ok ? ok(reply.value?.wire ?? null) : reply;
}
