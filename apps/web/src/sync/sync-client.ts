import {
  createId,
  decide,
  err,
  evolve,
  ok,
  type Command,
  type DecisionContext,
  type DomainState,
  type Id,
  type Result,
} from "@discussion-room/domain";
import {
  decodeServerMessage,
  encodeClientMessage,
  PROTOCOL_VERSION,
  receiveSync,
  startSync,
  validateClientMessage,
  type Checkpoint,
  type ClientMessage,
  type ClientSyncState,
  type CommandMessage,
  type EventMessage,
  type Member,
  type ProtocolError,
  type RejectMessage,
  type ServerMessage,
} from "@discussion-room/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

export type SyncConnection =
  | "idle"
  | "connecting"
  | "synchronizing"
  | "connected"
  | "reconnecting"
  | "failed";

type PendingCommand = {
  readonly commandId: Id;
  readonly command: Command;
};

export type SyncState = {
  readonly connection: SyncConnection;
  readonly checkpoint: Checkpoint | null;
  readonly snapshot: DomainState | null;
  readonly members: readonly Member[];
  readonly pendingCommands: readonly PendingCommand[];
  readonly rejection: RejectMessage | null;
};

type SocketEvents = { open: Event; message: MessageEvent<unknown>; close: CloseEvent };
type SocketListeners = { [K in keyof SocketEvents]: (event: SocketEvents[K]) => void };
type Socket = {
  readonly readyState: number;
  addEventListener: <K extends keyof SocketEvents>(type: K, listener: SocketListeners[K]) => void;
  close: () => void;
  send: (data: string) => void;
};

type SyncOptions = {
  readonly url: string;
  readonly projectId: Id;
  readonly clientId: string;
  readonly displayName: string;
  readonly token?: string;
  readonly createSocket?: (url: string) => Socket;
};

type SubmitError =
  | ProtocolError
  | { readonly code: "not_joined" | "duplicate_command" | "invalid_context" | "queue_full" };

export type SyncClient = {
  readonly store: Pick<StoreApi<SyncState>, "getState" | "subscribe">;
  readonly start: () => void;
  readonly stop: () => void;
  readonly submit: (commandId: Id, command: Command) => Result<Id, SubmitError>;
  readonly clearRejection: () => void;
};

type QueuedCommand = {
  readonly message: CommandMessage;
  readonly encoded: string;
  readonly context: Omit<DecisionContext, "timestamp"> & { readonly timestamp: string };
  sentOn: number;
  sentAfterSeq: number | null;
  ackSeq: number | null;
  // A snapshot may already contain a sent command whose ACK was lost. Keep it pending
  // for an idempotent retry, but avoid applying the same mutation twice in the view.
  coveredBySnapshot: boolean;
};

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const STABLE_CONNECTION_MS = 15_000;
const MAX_PENDING_COMMANDS = 16;

function projectPending(
  snapshot: DomainState | null,
  commands: readonly QueuedCommand[],
): DomainState | null {
  if (snapshot === null) return null;
  return commands.reduce((state, entry) => {
    if (entry.coveredBySnapshot || entry.message.command.type === "project.create") return state;
    const decision = decide(state, entry.message.command, entry.context);
    // The server may merge a conflict using committed history or validate additional context.
    return decision.ok ? decision.value.reduce(evolve, state) : state;
  }, snapshot);
}

function createContext(
  commandId: Id,
  command: Command,
  actor: string,
): QueuedCommand["context"] | null {
  const timestamp = new Date().toISOString();
  const header = { commandId, actor, timestamp, origin: "human" } as const;
  const entityId = command.type.endsWith(".create") ? createId() : undefined;
  const revisionId =
    command.type === "artifact.create" || command.type === "artifact.update"
      ? createId()
      : undefined;
  if (entityId?.ok === false || revisionId?.ok === false) return null;
  return {
    ...header,
    ...(entityId === undefined ? {} : { entityId: entityId.value }),
    ...(revisionId === undefined ? {} : { revisionId: revisionId.value }),
  };
}

function terminalClose(code: number): boolean {
  return [1002, 1003, 1007, 1008, 1009].includes(code);
}

export function createSyncClient(options: SyncOptions): SyncClient {
  const { projectId, clientId } = options;
  const store = createStore<SyncState>(() => ({
    connection: "idle",
    checkpoint: null,
    snapshot: null,
    members: [],
    pendingCommands: [],
    rejection: null,
  }));
  const pending = new Map<Id, QueuedCommand>();
  let sync: ClientSyncState = startSync(projectId).state;
  let socket: Socket | null = null;
  let generation = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  let backoff = INITIAL_BACKOFF_MS;
  let active = false;

  const publish = (patch: Partial<SyncState> = {}): void => {
    const entries = [...pending.values()];
    store.setState({
      checkpoint: sync.checkpoint,
      snapshot: projectPending(sync.checkpoint?.snapshot ?? null, entries),
      pendingCommands: entries.map(({ message }) => ({
        commandId: message.commandId,
        command: message.command,
      })),
      ...patch,
    });
  };

  const clearConnectionTimers = (): void => {
    clearTimeout(handshakeTimer);
    clearTimeout(stableTimer);
    stableTimer = undefined;
  };

  const retire = (current: Socket): void => {
    socket = null;
    clearConnectionTimers();
    current.close();
  };

  const scheduleRetry = (): void => {
    if (!active) return;
    const delay = backoff;
    backoff = Math.min(delay * 2, MAX_BACKOFF_MS);
    retryTimer = setTimeout(connect, delay);
    store.setState({ connection: "reconnecting", members: [] });
  };

  const fail = (current: Socket): void => {
    retire(current);
    active = false;
    store.setState({ connection: "failed", members: [] });
  };

  const sendEncoded = (current: Socket, encoded: string): boolean => {
    try {
      if (current.readyState === 1) {
        current.send(encoded);
        return true;
      }
    } catch {
      // A send racing socket shutdown is retried after the next join.
    }
    retire(current);
    scheduleRetry();
    return false;
  };

  const send = (current: Socket, message: ClientMessage): boolean => {
    const encoded = encodeClientMessage(message);
    if (encoded.ok) return sendEncoded(current, encoded.value);
    fail(current);
    return false;
  };

  const flush = (current: Socket): void => {
    for (const entry of pending.values()) {
      if (entry.ackSeq !== null || entry.sentOn === generation) continue;
      if (!sendEncoded(current, entry.encoded)) return;
      entry.sentOn = generation;
      entry.sentAfterSeq ??= sync.checkpoint?.seq ?? null;
    }
  };

  const watchHandshake = (current: Socket): void => {
    clearTimeout(handshakeTimer);
    handshakeTimer = setTimeout(() => {
      if (socket !== current) return;
      retire(current);
      scheduleRetry();
    }, HANDSHAKE_TIMEOUT_MS);
  };

  const reconcile = (batches: readonly EventMessage[]): void => {
    for (const batch of batches) pending.delete(batch.commandId);
    const seq = sync.checkpoint?.seq;
    for (const [id, entry] of pending) {
      if (seq !== undefined && entry.ackSeq !== null && entry.ackSeq <= seq) pending.delete(id);
    }
  };

  const receive = (current: Socket, message: ServerMessage): void => {
    switch (message.type) {
      case "ping":
        send(current, { type: "pong", nonce: message.nonce });
        return;
      case "ack": {
        const entry = pending.get(message.commandId);
        if (entry !== undefined) {
          entry.ackSeq = message.seq;
          reconcile([]);
          publish();
        }
        return;
      }
      case "reject": {
        if (!pending.delete(message.commandId)) return;
        if (message.current !== undefined && sync.phase === "ready") {
          const refresh = startSync(projectId);
          sync = { ...refresh.state, checkpoint: sync.checkpoint };
          watchHandshake(current);
          publish({ connection: "synchronizing", rejection: message });
          if (socket === current && refresh.request !== undefined) send(current, refresh.request);
        } else {
          publish({ rejection: message });
        }
        return;
      }
      case "event":
      case "joined": {
        const previous = sync;
        const step = receiveSync(previous, message);
        if (step.state === previous) return;
        sync =
          step.request !== undefined && step.state.phase === "snapshot"
            ? { ...step.state, checkpoint: previous.checkpoint }
            : step.state;
        if (step.request !== undefined) {
          watchHandshake(current);
          publish({ connection: "synchronizing" });
          if (socket === current) send(current, step.request);
          return;
        }
        if (message.type === "event") {
          reconcile([message]);
          publish();
          return;
        }
        if (message.mode === "snapshot") {
          for (const entry of pending.values()) {
            if (
              entry.message.command.type.endsWith(".create") &&
              entry.sentAfterSeq !== null &&
              entry.sentAfterSeq < message.seq
            ) {
              entry.coveredBySnapshot = true;
            }
          }
        }
        reconcile(message.mode === "events" ? message.events : []);
        clearTimeout(handshakeTimer);
        stableTimer ??= setTimeout(() => {
          backoff = INITIAL_BACKOFF_MS;
        }, STABLE_CONNECTION_MS);
        publish({ connection: "connected", members: message.members });
        if (socket === current) flush(current);
        return;
      }
      case "member": {
        if (message.projectId !== projectId || sync.phase !== "ready") return;
        const members = store
          .getState()
          .members.filter((member) => member.clientId !== message.member.clientId);
        store.setState({
          members: message.action === "joined" ? [...members, message.member] : members,
        });
        return;
      }
      case "presence":
      case "pong":
        return;
    }
  };

  function connect(): void {
    if (!active) return;
    let current: Socket;
    try {
      current = options.createSocket?.(options.url) ?? new WebSocket(options.url);
    } catch {
      scheduleRetry();
      return;
    }
    socket = current;
    generation += 1;
    // A full refresh may retain the previous checkpoint only for display and optimistic edits.
    const join = startSync(projectId, sync.phase === "snapshot" ? null : sync.checkpoint);
    sync = { ...join.state, checkpoint: sync.checkpoint };
    current.addEventListener("open", () => {
      if (socket !== current) return;
      watchHandshake(current);
      store.setState({ connection: "synchronizing" });
      if (socket !== current) return;
      const hello: ClientMessage = {
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        clientId,
        displayName: options.displayName,
        ...(options.token === undefined ? {} : { token: options.token }),
      };
      if (send(current, hello) && join.request !== undefined) send(current, join.request);
    });
    current.addEventListener("message", (event) => {
      if (socket !== current) return;
      const data: unknown = event.data;
      const decoded = typeof data === "string" ? decodeServerMessage(data) : null;
      if (decoded?.ok) receive(current, decoded.value);
      else fail(current);
    });
    current.addEventListener("close", (event) => {
      if (socket !== current) return;
      socket = null;
      clearConnectionTimers();
      if (terminalClose(event.code)) {
        active = false;
        store.setState({ connection: "failed", members: [] });
      } else {
        scheduleRetry();
      }
    });
    watchHandshake(current);
    store.setState({ connection: "connecting" });
  }

  return {
    store: { getState: store.getState, subscribe: store.subscribe },
    start: () => {
      if (active) return;
      active = true;
      backoff = INITIAL_BACKOFF_MS;
      connect();
    },
    stop: () => {
      active = false;
      clearTimeout(retryTimer);
      if (socket !== null) retire(socket);
      store.setState({ connection: "idle", members: [] });
    },
    submit: (commandId, command) => {
      if (!active || sync.checkpoint === null) return err({ code: "not_joined" });
      if (pending.has(commandId)) return err({ code: "duplicate_command" });
      if (pending.size >= MAX_PENDING_COMMANDS) return err({ code: "queue_full" });
      const checked = validateClientMessage({ type: "command", projectId, commandId, command });
      if (!checked.ok) return checked;
      const message = checked.value;
      if (message.type !== "command") return err({ code: "invalid_message" });
      const context = createContext(commandId, message.command, clientId);
      if (context === null) return err({ code: "invalid_context" });
      pending.set(commandId, {
        message,
        encoded: JSON.stringify(message),
        context,
        sentOn: 0,
        sentAfterSeq: null,
        ackSeq: null,
        coveredBySnapshot: false,
      });
      publish();
      if (socket !== null && store.getState().connection === "connected") flush(socket);
      return ok(commandId);
    },
    clearRejection: () => {
      store.setState({ rejection: null });
    },
  };
}
