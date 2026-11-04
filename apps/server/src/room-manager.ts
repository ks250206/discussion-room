import { randomUUID } from "node:crypto";
import type { DomainState, Id } from "@discussion-room/domain";
import {
  applyPresence,
  decodeClientMessage,
  encodeServerMessage,
  expirePresence,
  PROTOCOL_LIMITS,
  PRESENCE_TTL_MS,
  releaseClient,
  type CommandMessage,
  type JoinMessage,
  type Member,
  type Presence,
  type PresenceRecord,
  type ServerMessage,
} from "@discussion-room/protocol";
import { WebSocket, type RawData } from "ws";
import type { Logger } from "./log.ts";
import type { Repository } from "./repository/index.ts";
import { readJoinReply } from "./repository/resume.ts";

export type RoomManagerOptions = {
  repository?: Repository;
  logger: Logger;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
};

type Room = {
  projectId: Id;
  graph: DomainState;
  members: Map<string, Session>;
  presence: readonly PresenceRecord[];
};
type Session = {
  socket: WebSocket;
  member?: Member;
  room?: Room;
  presenceReplay?: IterableIterator<string>;
  heartbeat?: { nonce: string; timeout: ReturnType<typeof setTimeout> };
};

function frameBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.isBuffer(data) ? data : new Uint8Array(data);
}

function validPresence(graph: DomainState, presence: Presence): boolean {
  const { boardId, selection, editingItemId } = presence;
  if (!graph.entities.boards.some((board) => board.id === boardId)) return false;
  const itemIds = new Set(
    graph.entities.canvasItems.filter((item) => item.boardId === boardId).map((item) => item.id),
  );
  return (
    selection.every((id) => itemIds.has(id)) &&
    (editingItemId === undefined || itemIds.has(editingItemId))
  );
}

export function createRoomManager({
  repository,
  logger,
  heartbeatIntervalMs = 15_000,
  heartbeatTimeoutMs = 10_000,
}: RoomManagerOptions) {
  const rooms = new Map<string, Room>();
  const sessions = new Set<Session>();

  function sendWire(session: Session, wire: string, sent?: (error?: Error) => void): boolean {
    const { socket } = session;
    if (socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount + Buffer.byteLength(wire) > 2 * PROTOCOL_LIMITS.maxMessageBytes) {
      socket.terminate();
      return false;
    }
    socket.send(wire, sent);
    return true;
  }

  function encode(message: ServerMessage): string | undefined {
    const result = encodeServerMessage(message);
    if (result.ok) return result.value;
    logger({ level: "error", event: "room_encode_error", code: result.error.code });
    return undefined;
  }

  function send(session: Session, message: ServerMessage): void {
    const wire = encode(message);
    if (wire !== undefined) sendWire(session, wire);
  }

  function broadcast(room: Room, message: ServerMessage, excluded?: Session): void {
    const wire = encode(message);
    if (wire === undefined) return;
    for (const session of room.members.values()) {
      if (session !== excluded) sendWire(session, wire);
    }
  }

  function expire(room: Room, now: number): void {
    if (!room.presence.some(({ receivedAt }) => now - receivedAt >= PRESENCE_TTL_MS)) return;
    const live = expirePresence(room.presence, now);
    if (!live.ok) {
      logger({ level: "error", event: "room_presence_error", code: live.error.code });
      return;
    }
    const previous = room.presence;
    room.presence = live.value;
    const active = new Set(live.value.map(({ clientId }) => clientId));
    for (const { clientId, presence } of previous) {
      if (active.has(clientId)) continue;
      broadcast(room, {
        type: "presence",
        projectId: room.projectId,
        clientId,
        presence: { boardId: presence.boardId, selection: [] },
      });
    }
  }

  function leave(session: Session): void {
    const { member, room } = session;
    if (!member || !room) return;
    delete session.room;
    delete session.presenceReplay;
    room.members.delete(member.clientId);
    if (room.members.size === 0) {
      rooms.delete(room.projectId);
      return;
    }
    const now = performance.now();
    expire(room, now);
    const released = releaseClient(room.presence, member.clientId, now);
    if (released.ok) room.presence = released.value;
    else logger({ level: "error", event: "room_presence_error", code: released.error.code });
    broadcast(room, { type: "member", projectId: room.projectId, action: "left", member });
  }

  function close(session: Session, code: number, reason: string): void {
    leave(session);
    session.socket.close(code, reason);
  }

  function replayPresence(session: Session, room: Room, member: Member): void {
    const clients = room.presence
      .map(({ clientId }) => clientId)
      .filter((clientId) => clientId !== member.clientId)
      .values();
    session.presenceReplay = clients;

    // Queue one frame at a time so the initial state cannot fill a healthy peer's send buffer.
    function sendNext(error?: Error): void {
      if (error || session.presenceReplay !== clients) return;
      const now = performance.now();
      for (const clientId of clients) {
        // A broadcast or departure may have changed this client's presence during a write.
        const record = room.presence.find((entry) => entry.clientId === clientId);
        if (record === undefined || now - record.receivedAt >= PRESENCE_TTL_MS) continue;
        const wire = encode({
          type: "presence",
          projectId: room.projectId,
          clientId,
          presence: record.presence,
        });
        if (wire === undefined) continue;
        if (sendWire(session, wire, sendNext)) return;
        break;
      }
      delete session.presenceReplay;
    }

    sendNext();
  }

  function join(session: Session, member: Member, message: JoinMessage): void {
    const { projectId } = message;
    const existing = rooms.get(projectId);
    const occupant = existing?.members.get(member.clientId);
    if (occupant !== undefined && occupant !== session) {
      close(session, 1013, "Client ID already joined");
      return;
    }
    if (occupant === undefined && (existing?.members.size ?? 0) >= PROTOCOL_LIMITS.maxMembers) {
      close(session, 1008, "Room full");
      return;
    }
    if (repository === undefined) {
      close(session, 1011, "Repository unavailable");
      return;
    }
    const members = [member];
    for (const peer of existing?.members.values() ?? []) {
      if (peer !== session && peer.member !== undefined) members.push(peer.member);
    }
    const reply = readJoinReply(repository, message, members);
    if (!reply.ok) {
      logger({ level: "error", event: "room_join_error", code: reply.error.code });
      close(session, 1011, "Cannot load room");
      return;
    }
    if (reply.value === null) {
      close(session, 1008, "Project not found");
      return;
    }
    // No async boundary between the read, joined frame and registration for subsequent broadcasts.
    const { wire, graph } = reply.value;
    if (!sendWire(session, wire)) return;
    const room = existing ?? { projectId, graph, members: new Map(), presence: [] };
    room.graph = graph;
    rooms.set(projectId, room);
    expire(room, performance.now());
    if (occupant !== session) {
      leave(session);
      session.room = room;
      room.members.set(member.clientId, session);
      broadcast(room, { type: "member", projectId, action: "joined", member }, session);
    }
    replayPresence(session, room, member);
  }

  // #41 can dispatch the pipeline after these membership and project checks.
  function command(session: Session, { projectId, commandId }: CommandMessage): void {
    if (session.room === undefined) {
      send(session, {
        type: "reject",
        commandId,
        code: "not_joined",
        message: "Join a room first",
      });
    } else if (session.room.projectId !== projectId) {
      send(session, {
        type: "reject",
        commandId,
        code: "project_mismatch",
        message: "Command targets a different project",
      });
    } else {
      send(session, {
        type: "reject",
        commandId,
        code: "forbidden",
        message: "Room commands are unavailable",
      });
    }
  }

  function receive(session: Session, data: RawData, binary: boolean): void {
    if (session.socket.readyState !== WebSocket.OPEN) return;
    if (binary) {
      close(session, 1003, "Expected a text frame");
      return;
    }
    const decoded = decodeClientMessage(frameBytes(data));
    if (!decoded.ok) {
      close(session, 1002, decoded.error.code);
      return;
    }
    const message = decoded.value;
    const { member, room } = session;
    switch (message.type) {
      case "ping":
        send(session, { type: "pong", nonce: message.nonce });
        break;
      case "pong":
        if (session.heartbeat?.nonce === message.nonce) clearHeartbeat(session);
        break;
      case "hello":
        if (member !== undefined) {
          close(session, 1008, "Hello already received");
          break;
        }
        session.member = { clientId: message.clientId, displayName: message.displayName };
        break;
      case "join":
        if (member === undefined) close(session, 1008, "Hello required");
        else join(session, member, message);
        break;
      case "command":
        command(session, message);
        break;
      case "presence": {
        if (!room || !member || room.projectId !== message.projectId) break;
        if (!validPresence(room.graph, message.presence)) break;
        const now = performance.now();
        expire(room, now);
        const update = applyPresence(room.presence, member.clientId, message.presence, now);
        if (!update.ok) {
          logger({ level: "error", event: "room_presence_error", code: update.error.code });
          break;
        }
        room.presence = update.value.records;
        broadcast(room, {
          type: "presence",
          projectId: room.projectId,
          clientId: member.clientId,
          presence: update.value.presence,
        });
        break;
      }
    }
  }

  function clearHeartbeat(session: Session): void {
    if (session.heartbeat === undefined) return;
    clearTimeout(session.heartbeat.timeout);
    delete session.heartbeat;
  }

  function connect(socket: WebSocket): void {
    const session: Session = { socket };
    sessions.add(session);
    socket.on("message", (data, binary) => receive(session, data, binary));
    socket.once("close", () => {
      clearHeartbeat(session);
      sessions.delete(session);
      leave(session);
    });
  }

  const heartbeat = setInterval(() => {
    for (const session of sessions) {
      if (session.socket.readyState !== WebSocket.OPEN || session.heartbeat !== undefined) continue;
      const nonce = randomUUID();
      const timeout = setTimeout(() => session.socket.terminate(), heartbeatTimeoutMs);
      timeout.unref();
      session.heartbeat = { nonce, timeout };
      send(session, { type: "ping", nonce });
    }
  }, heartbeatIntervalMs);
  const presenceExpiry = setInterval(() => {
    const now = performance.now();
    for (const room of rooms.values()) {
      if (room.presence.length > 0) expire(room, now);
    }
  }, 1_000);
  heartbeat.unref();
  presenceExpiry.unref();

  return {
    connect,
    stop() {
      clearInterval(heartbeat);
      clearInterval(presenceExpiry);
      for (const session of sessions) clearHeartbeat(session);
    },
  };
}
