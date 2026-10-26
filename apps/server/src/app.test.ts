import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { createAppServer } from "./app.ts";

const server = createAppServer();
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("GET /api/health returns ok", async () => {
  const res = await fetch(`${baseUrl}/api/health`);

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("unknown routes return 404", async () => {
  const res = await fetch(`${baseUrl}/nope`);

  expect(res.status).toBe(404);
});
