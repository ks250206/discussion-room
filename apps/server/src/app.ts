import { createServer, type RequestListener, type Server } from "node:http";

export type HealthResponse = {
  status: "ok";
};

const sendJson = (res: Parameters<RequestListener>[1], statusCode: number, body: unknown): void => {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

export const handleRequest: RequestListener = (req, res) => {
  const url = URL.parse(req.url ?? "/", "http://localhost");

  if (!url) {
    sendJson(res, 400, { error: "bad_request" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    const body: HealthResponse = { status: "ok" };
    sendJson(res, 200, body);
    return;
  }

  sendJson(res, 404, { error: "not_found" });
};

export const createAppServer = (): Server => createServer(handleRequest);
