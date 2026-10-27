import type { WorkerPort } from "./controller.ts";

export function createModuleWorkerPort(): WorkerPort {
  const worker = new Worker(new URL("./python.worker.ts", import.meta.url), { type: "module" });
  return {
    send: (request) => {
      // Dedicated Worker.postMessage does not accept Window's targetOrigin argument.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      worker.postMessage(request);
    },
    terminate: () => worker.terminate(),
    listen: (handlers) => {
      const onMessage = (event: MessageEvent<unknown>) => handlers.message(event);
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", handlers.error);
      worker.addEventListener("messageerror", handlers.messageerror);
      return () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", handlers.error);
        worker.removeEventListener("messageerror", handlers.messageerror);
      };
    },
  };
}
