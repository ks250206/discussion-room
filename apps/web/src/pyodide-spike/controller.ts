import * as v from "valibot";
import { errorText, responseSchema } from "./protocol.ts";
import type { Demo, WorkerRequest } from "./protocol.ts";

export type WorkerPort = {
  send: (request: WorkerRequest) => void;
  terminate: () => void;
  listen: (handlers: WorkerHandlers) => () => void;
};
export type WorkerHandlers = {
  message: (event: { data: unknown }) => void;
  error: () => void;
  messageerror: () => void;
};
export type Snapshot = {
  status: "idle" | "loading" | "ready" | "running" | "stopped" | "error";
  generation: number;
  loadMs: number | null;
  turnaroundMs: number | null;
  computeMs: number | null;
  heapBytes: number | null;
  output: string;
  error: string | null;
};
export const initialSnapshot: Snapshot = {
  status: "idle",
  generation: 0,
  loadMs: null,
  turnaroundMs: null,
  computeMs: null,
  heapBytes: null,
  output: "",
  error: null,
};

// All state is owned by this controller instance. No Python work occurs here.
export function createPyodideController(
  createWorker: () => WorkerPort,
  now = () => performance.now(),
) {
  let snapshot = initialSnapshot;
  let worker: WorkerPort | null = null;
  let cleanup: (() => void) | null = null;
  let generation = 0;
  let runId = 0;
  let startedAt = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  function publish(patch: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }
  function retire() {
    generation += 1;
    if (worker !== null) {
      cleanup?.();
      cleanup = null;
      worker.terminate();
      worker = null;
    }
  }
  function fail(message: string) {
    retire();
    publish({ status: "error", error: message, heapBytes: null });
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize() {
      if (disposed || ["loading", "running", "ready"].includes(snapshot.status)) return;
      retire();
      const currentGeneration = generation;
      startedAt = now();
      publish({ ...initialSnapshot, status: "loading", generation: currentGeneration });
      try {
        const currentWorker = createWorker();
        worker = currentWorker;
        cleanup = currentWorker.listen({
          message: (event) => {
            if (disposed || currentGeneration !== generation) return;
            const parsed = v.safeParse(responseSchema, event.data);
            if (!parsed.success) {
              fail("Worker から不正な応答を受信しました。");
              return;
            }
            const response = parsed.output;
            if (response.type === "ready" && snapshot.status === "loading") {
              publish({
                status: "ready",
                loadMs: now() - startedAt,
                heapBytes: response.heapBytes,
              });
            } else if (
              response.type === "result" &&
              snapshot.status === "running" &&
              response.runId === runId
            ) {
              publish({
                status: "ready",
                output: response.output,
                computeMs: response.computeMs,
                turnaroundMs: now() - startedAt,
                heapBytes: response.heapBytes,
              });
            } else if (
              response.type === "error" &&
              ((snapshot.status === "loading" && response.runId === null) ||
                (snapshot.status === "running" && response.runId === runId))
            ) {
              fail(response.message);
            }
          },
          error: () => {
            if (currentGeneration === generation && !disposed)
              fail("Worker が停止しました。環境を再起動できます。");
          },
          messageerror: () => {
            if (currentGeneration === generation && !disposed)
              fail("Worker 応答の読み取りに失敗しました。");
          },
        });
        currentWorker.send({ type: "initialize" });
      } catch (error) {
        fail(errorText(error));
      }
    },
    run(demo: Demo) {
      if (disposed || snapshot.status !== "ready" || worker === null) return;
      runId += 1;
      startedAt = now();
      publish({ status: "running", output: "", error: null, turnaroundMs: null, computeMs: null });
      try {
        worker.send({ type: "run", runId, demo });
      } catch (error) {
        fail(errorText(error));
      }
    },
    stop() {
      if (disposed || !["loading", "running"].includes(snapshot.status)) return;
      retire();
      publish({
        status: "stopped",
        heapBytes: null,
        output: "",
        error: null,
        loadMs: null,
        turnaroundMs: null,
        computeMs: null,
      });
    },
    dispose() {
      disposed = true;
      retire();
      listeners.clear();
    },
  };
}
