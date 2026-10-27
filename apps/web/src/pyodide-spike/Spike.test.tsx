// @vitest-environment happy-dom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, expect, test } from "vite-plus/test";
import { Spike } from "./Spike.tsx";
import type { WorkerHandlers, WorkerPort } from "./controller.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

afterEach(cleanup);

function workers() {
  const records: { handlers: WorkerHandlers | null; sent: WorkerRequest[]; terminated: boolean }[] =
    [];
  function createWorker(): WorkerPort {
    const record = {
      handlers: null as WorkerHandlers | null,
      sent: [] as WorkerRequest[],
      terminated: false,
    };
    records.push(record);
    return {
      send: (request) => {
        record.sent.push(request);
      },
      terminate: () => {
        record.terminated = true;
      },
      listen: (handlers) => {
        record.handlers = handlers;
        return () => {
          record.handlers = null;
        };
      },
    };
  }
  function current() {
    const record = records.at(-1);
    if (record === undefined) throw new Error("No test Worker");
    return record;
  }
  function respond(response: WorkerResponse) {
    act(() => current().handlers?.message({ data: response }));
  }
  return { records, createWorker, current, respond };
}

test("StrictMode effect replay keeps lazy initialization, NumPy run and unmount cleanup working", async () => {
  const f = workers();
  const user = userEvent.setup();
  const view = render(
    <StrictMode>
      <Spike createWorker={f.createWorker} />
    </StrictMode>,
  );
  expect(f.records).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "CDN から環境をロード / 再起動" }));
  expect(f.current().sent).toEqual([{ type: "initialize" }]);
  f.respond({ type: "ready", heapBytes: 123 });
  await user.click(screen.getByRole("button", { name: "NumPy を実行" }));
  expect(f.current().sent.at(-1)).toEqual({ type: "run", runId: 1, demo: "numpy" });
  f.respond({ type: "result", runId: 1, output: '{"sum":50005000}', computeMs: 1, heapBytes: 123 });
  expect(screen.getByLabelText("計算結果").textContent).toBe('{"sum":50005000}');
  expect(screen.getByRole("button", { name: "NumPy を実行" }).hasAttribute("disabled")).toBe(false);
  view.unmount();
  expect(f.current().terminated).toBe(true);
  expect(f.current().handlers).toBeNull();
});

test("effect recreation with preserved UI state retires the old controller and permits a fresh run", async () => {
  const old = workers();
  const next = workers();
  const user = userEvent.setup();
  const view = render(
    <StrictMode>
      <Spike createWorker={old.createWorker} />
    </StrictMode>,
  );
  await user.click(screen.getByRole("button", { name: "応答テスト: 0" }));
  await user.click(screen.getByRole("button", { name: "CDN から環境をロード / 再起動" }));
  const queued = old.current().handlers?.message;
  // Fast Refresh also replays effects while preserving UI state. Changing the
  // stable dependency here exercises that lifecycle without a dev-server mock.
  view.rerender(
    <StrictMode>
      <Spike createWorker={next.createWorker} />
    </StrictMode>,
  );
  expect(old.current().terminated).toBe(true);
  expect(screen.getByRole("button", { name: "応答テスト: 1" })).toBeTruthy();
  expect(next.records).toHaveLength(0);
  act(() => queued?.({ data: { type: "ready", heapBytes: 999 } }));
  expect(screen.getByRole("button", { name: "NumPy を実行" }).hasAttribute("disabled")).toBe(true);
  await user.click(screen.getByRole("button", { name: "CDN から環境をロード / 再起動" }));
  expect(next.current().sent).toEqual([{ type: "initialize" }]);
  next.respond({ type: "ready", heapBytes: 123 });
  await user.click(screen.getByRole("button", { name: "NumPy を実行" }));
  next.respond({ type: "result", runId: 1, output: "fresh result", computeMs: 1, heapBytes: 123 });
  expect(screen.getByLabelText("計算結果").textContent).toBe("fresh result");
});
