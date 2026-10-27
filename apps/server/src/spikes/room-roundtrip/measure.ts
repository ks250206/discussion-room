import { performance } from "node:perf_hooks";
import * as v from "valibot";
import { WebSocket } from "ws";
import { createRoomSpike } from "./app.ts";
import { outputSchema, type Output } from "./messages.ts";

const spike = createRoomSpike();
const opened: WebSocket[] = [];
const connect = async (origin: string) => {
  const socket = new WebSocket(origin.replace(/^http/, "ws") + "/ws", { origin });
  opened.push(socket);
  const queue: Output[] = [];
  let wake: (() => void) | undefined;
  socket.on("message", (bytes) => {
    const input: unknown = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString() : "null");
    queue.push(v.parse(outputSchema, input));
    wake?.();
  });
  socket.on("error", (error: Error) => {
    console.error(error.message);
    wake?.();
  });
  const next = async (type: Output["type"]): Promise<Output> => {
    const deadline = performance.now() + 2000;
    for (;;) {
      const index = queue.findIndex((message) => message.type === type);
      const message = index < 0 ? undefined : queue.splice(index, 1)[0];
      if (message !== undefined) return message;
      if (performance.now() > deadline) throw new Error(`timeout waiting for ${type}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 100);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  };
  const send = (input: unknown): void => {
    socket.send(JSON.stringify(input));
  };
  await next("ready");
  send({ type: "join", projectId: "measurement" });
  await next("snapshot");
  return { next, send, queue };
};

try {
  await new Promise<void>((resolve, reject) => {
    spike.server.once("error", reject);
    spike.server.listen(0, "127.0.0.1", resolve);
  });
  const address = spike.server.address();
  if (address === null || typeof address === "string") throw new Error("expected TCP address");
  const origin = `http://127.0.0.1:${address.port}`;
  const one = await connect(origin),
    two = await connect(origin);
  let requestId = 0;
  const results = [];
  for (const hz of [10, 20, 30, 60]) {
    const before = { ...spike.metrics },
      samples: number[] = [];
    const started = performance.now(),
      count = hz; // one nominal second for each frequency
    for (let i = 0; i < count; i++) {
      const start = performance.now();
      one.send({ type: "move", requestId: requestId++, position: { x: i, y: 150 } });
      await one.next("ack");
      samples.push(performance.now() - start);
      await two.next("position");
      // Drain sender position broadcasts; this queue is measurement-only, bounded by this trace.
      one.queue.length = 0;
      const remaining = started + ((i + 1) * 1000) / hz - performance.now();
      if (remaining > 0)
        await new Promise<void>((resolve) => {
          setTimeout(resolve, remaining);
        });
    }
    const durationMs = performance.now() - started;
    samples.sort((a, b) => a - b);
    const percentile = (p: number): number | undefined =>
      samples[Math.floor((samples.length - 1) * p)];
    results.push({
      hz,
      clients: 2,
      durationMs,
      moves: spike.metrics.moves - before.moves,
      inboundJson: spike.metrics.received - before.received,
      outboundJson: spike.metrics.sent - before.sent,
      ackRttP50Ms: percentile(0.5),
      ackRttP95Ms: percentile(0.95),
    });
  }
  console.log(
    JSON.stringify(
      {
        method:
          "same-process-client performance.now send-to-ack RTT; loopback; 1 synthetic card; no persistence",
        node: process.version,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  for (const socket of opened) socket.terminate();
  await spike.close();
}
