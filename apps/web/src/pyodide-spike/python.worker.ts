import * as v from "valibot";
import { loadEngine } from "./engine.ts";
import { errorText, requestSchema } from "./protocol.ts";
import type { WorkerResponse } from "./protocol.ts";

function send(response: WorkerResponse) {
  // DedicatedWorkerGlobalScope.postMessage has no targetOrigin argument.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  globalThis.postMessage(response);
}

// Closure-owned Worker state; initializing/running cannot overlap even while awaiting IO.
function startWorker() {
  let engine: Awaited<ReturnType<typeof loadEngine>> | null = null;
  let busy = false;
  globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
    const parsed = v.safeParse(requestSchema, event.data);
    if (!parsed.success || busy) return;
    const request = parsed.output;
    busy = true;
    async function handle() {
      try {
        if (request.type === "initialize") {
          engine ??= await loadEngine();
          send({ type: "ready", heapBytes: engine.heapBytes() });
        } else if (engine !== null) {
          const result = await engine.run(request.demo);
          send({ type: "result", runId: request.runId, ...result });
        } else {
          send({ type: "error", runId: request.runId, message: "Engine is not initialized" });
        }
      } catch (error) {
        send({
          type: "error",
          runId: request.type === "run" ? request.runId : null,
          message: errorText(error),
        });
      } finally {
        busy = false;
      }
    }
    void handle();
  });
}
startWorker();
