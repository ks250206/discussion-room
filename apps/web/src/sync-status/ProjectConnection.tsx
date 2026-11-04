import type { Id } from "@discussion-room/domain";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createSyncClient } from "../sync/sync-client.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";

function createProjectConnection(projectId: Id) {
  const url = new URL("/ws", window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  // Each mounted project connection gets its own identity. The client retains it on retry.
  const clientId = Array.from(window.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return createSyncClient({ projectId, clientId, displayName: "ゲスト", url: url.href });
}

export function ProjectConnection({ projectId }: { readonly projectId: Id }) {
  const [client] = useState(() => createProjectConnection(projectId));
  useEffect(() => {
    let cancelled = false;
    // Let StrictMode's setup/cleanup probe finish before opening a socket.
    queueMicrotask(() => {
      if (!cancelled) client.start();
    });
    return () => {
      cancelled = true;
      client.stop();
    };
  }, [client]);
  const connection = useSyncExternalStore(
    client.store.subscribe,
    () => client.store.getState().connection,
  );
  const pendingCount = useSyncExternalStore(
    client.store.subscribe,
    () => client.store.getState().pendingCommands.length,
  );
  const rejected = useSyncExternalStore(
    client.store.subscribe,
    () => client.store.getState().rejection !== null,
  );

  const phase =
    connection === "connected" || connection === "reconnecting"
      ? connection
      : connection === "connecting" || connection === "synchronizing"
        ? "connecting"
        : "disconnected";
  return (
    <ConnectionStatus
      phase={phase}
      pendingCount={pendingCount}
      locale="ja"
      onDismissRejection={client.clearRejection}
      {...(rejected ? { rejection: "変更を保存できませんでした。" } : {})}
    />
  );
}
