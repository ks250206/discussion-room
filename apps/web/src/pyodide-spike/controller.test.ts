import { expect, test } from "vite-plus/test";
import { createPyodideController } from "./controller.ts";
import type { WorkerHandlers, WorkerPort } from "./controller.ts";
import { outputLimit } from "./protocol.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

function fixture() {
  const workers: {
    port: WorkerPort;
    sent: WorkerRequest[];
    terminated: boolean;
    handlers: WorkerHandlers | null;
  }[] = [];
  let clock = 100;
  const controller = createPyodideController(
    () => {
      const sent: WorkerRequest[] = [];
      const record = {
        sent,
        terminated: false,
        handlers: null as WorkerHandlers | null,
        port: {
          listen: (handlers: WorkerHandlers) => {
            record.handlers = handlers;
            return () => {
              record.handlers = null;
            };
          },
          send: (request: WorkerRequest) => {
            sent.push(request);
          },
          terminate: () => {
            record.terminated = true;
          },
        } satisfies WorkerPort,
      };
      workers.push(record);
      return record.port;
    },
    () => clock,
  );
  function current() {
    const value = workers.at(-1);
    if (value === undefined) throw new Error("Missing test Worker");
    return value;
  }
  function send(response: WorkerResponse) {
    current().handlers?.message?.({ data: response });
  }
  function ready() {
    controller.initialize();
    send({ type: "ready", heapBytes: 1048576 });
  }
  return {
    controller,
    workers,
    current,
    send,
    ready,
    setClock: (value: number) => {
      clock = value;
    },
  };
}

test("is lazy and measures first initialization on the same UI clock", () => {
  const f = fixture();
  expect(f.workers).toHaveLength(0);
  expect(f.controller.getSnapshot().loadMs).toBeNull();
  f.controller.initialize();
  f.controller.initialize();
  expect(f.workers).toHaveLength(1);
  expect(f.current().sent).toEqual([{ type: "initialize" }]);
  f.setClock(350);
  f.send({ type: "ready", heapBytes: null });
  expect(f.controller.getSnapshot()).toMatchObject({
    status: "ready",
    loadMs: 250,
    heapBytes: null,
  });
});

test("stops during loading and ignores queued old ready, errors and native errors", () => {
  const f = fixture();
  f.controller.initialize();
  const old = f.current();
  const message = old.handlers?.message;
  const error = old.handlers?.error;
  f.controller.stop();
  expect(old.terminated).toBe(true);
  f.controller.initialize();
  message?.({ data: { type: "ready", heapBytes: 99 } });
  error?.();
  expect(f.controller.getSnapshot().status).toBe("loading");
  f.send({ type: "ready", heapBytes: 123 });
  expect(f.controller.getSnapshot().heapBytes).toBe(123);
  expect(f.workers).toHaveLength(2);
});

test("infinite loop Stop retires worker; next explicit load and NumPy run succeed", () => {
  const f = fixture();
  f.ready();
  f.controller.run("infinite");
  const old = f.current();
  const queued = old.handlers?.message;
  f.controller.stop();
  expect(f.controller.getSnapshot()).toMatchObject({ status: "stopped", heapBytes: null });
  expect(old.terminated).toBe(true);
  f.ready();
  f.controller.run("numpy");
  queued?.({ data: { type: "result", runId: 1, output: "stale", computeMs: 1, heapBytes: 99 } });
  expect(f.controller.getSnapshot().status).toBe("running");
  f.setClock(400);
  f.send({
    type: "result",
    runId: 2,
    output: '{"sum":50005000}',
    computeMs: 4,
    heapBytes: 1048576,
  });
  expect(f.controller.getSnapshot()).toMatchObject({
    status: "ready",
    output: '{"sum":50005000}',
    turnaroundMs: 300,
    computeMs: 4,
  });
});

test("serializes runs and ignores out of order or duplicate results", () => {
  const f = fixture();
  f.ready();
  f.controller.run("numpy");
  f.controller.run("infinite");
  expect(f.current().sent).toHaveLength(2);
  f.send({ type: "result", runId: 99, output: "wrong", computeMs: 0, heapBytes: null });
  expect(f.controller.getSnapshot().status).toBe("running");
  f.send({ type: "result", runId: 1, output: "correct", computeMs: 2, heapBytes: null });
  f.send({ type: "result", runId: 1, output: "duplicate", computeMs: 2, heapBytes: null });
  expect(f.controller.getSnapshot().output).toBe("correct");
});

test("Python exception retires the environment and permits clean initialization", () => {
  const f = fixture();
  f.ready();
  f.controller.run("exception");
  f.send({ type: "error", runId: 1, message: "ValueError" });
  expect(f.current().terminated).toBe(true);
  expect(f.controller.getSnapshot()).toMatchObject({ status: "error", error: "ValueError" });
  f.ready();
  expect(f.controller.getSnapshot()).toMatchObject({ status: "ready", error: null });
});

test("download failure, native Worker error and message deserialization failure are recoverable", () => {
  const f = fixture();
  f.controller.initialize();
  f.send({ type: "error", runId: null, message: "download failed" });
  expect(f.controller.getSnapshot().status).toBe("error");
  f.ready();
  f.current().handlers?.error?.();
  expect(f.controller.getSnapshot().status).toBe("error");
  f.ready();
  f.current().handlers?.messageerror?.();
  expect(f.controller.getSnapshot().status).toBe("error");
  f.ready();
  expect(f.controller.getSnapshot().status).toBe("ready");
});

test("rejects malformed, excessive and non-finite measurements at the boundary", () => {
  for (const data of [
    null,
    { type: "ready", heapBytes: -1 },
    { type: "ready", heapBytes: Infinity },
    { type: "error", runId: null, message: "x".repeat(outputLimit + 1) },
  ]) {
    const f = fixture();
    f.controller.initialize();
    f.current().handlers?.message?.({ data });
    expect(f.controller.getSnapshot().status).toBe("error");
    expect(f.current().terminated).toBe(true);
  }
});

test("disabled Stop states do not terminate a ready environment or create workers", () => {
  const f = fixture();
  f.controller.stop();
  f.controller.run("numpy");
  expect(f.workers).toHaveLength(0);
  f.ready();
  f.controller.stop();
  expect(f.current().terminated).toBe(false);
  expect(f.controller.getSnapshot().status).toBe("ready");
});

test("dispose releases the Worker and listeners and ignores queued messages", () => {
  const f = fixture();
  let calls = 0;
  f.controller.subscribe(() => {
    calls += 1;
  });
  f.controller.initialize();
  const queued = f.current().handlers?.message;
  f.controller.dispose();
  queued?.({ data: { type: "ready", heapBytes: 1 } });
  f.controller.initialize();
  f.controller.run("numpy");
  f.controller.stop();
  expect(f.current().terminated).toBe(true);
  expect(calls).toBe(1);
  expect(f.workers).toHaveLength(1);
});

test("Worker construction and postMessage failures produce bounded recoverable errors", () => {
  const controller = createPyodideController(() => {
    throw new Error("x".repeat(10000));
  });
  controller.initialize();
  expect(controller.getSnapshot().status).toBe("error");
  expect(controller.getSnapshot().error).toHaveLength(outputLimit);
  const f = fixture();
  f.ready();
  f.current().port.send = () => {
    throw new Error("cannot send");
  };
  f.controller.run("numpy");
  expect(f.controller.getSnapshot()).toMatchObject({ status: "error", error: "cannot send" });
  expect(f.current().terminated).toBe(true);
});
