import { createAppServer } from "./app.ts";

const host = process.env["HOST"] ?? "127.0.0.1";
const port = Number(process.env["PORT"] ?? 8787);

const server = createAppServer();

server.listen(port, host, () => {
  console.log(`discussion-room server listening on http://${host}:${port}`);
});
