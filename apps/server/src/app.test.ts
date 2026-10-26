import { type AddressInfo, connect } from "node:net";
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

test("an unparsable request target returns 400 and keeps the server alive", async () => {
  const { port } = server.address() as AddressInfo;
  const rawResponse = await new Promise<string>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.end("GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      data += chunk;
    });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });

  expect(rawResponse.startsWith("HTTP/1.1 400")).toBe(true);
  expect((await fetch(`${baseUrl}/api/health`)).status).toBe(200);
});
