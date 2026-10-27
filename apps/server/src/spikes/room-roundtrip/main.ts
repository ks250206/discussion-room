import { createRoomSpike } from "./app.ts";

const spike = createRoomSpike();
const shutdown = (): void => {
  void spike.close().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
spike.server.once("error", (error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
  shutdown();
});
spike.server.listen(0, "127.0.0.1", () => {
  const address = spike.server.address();
  if (address === null || typeof address === "string") {
    shutdown();
    return;
  }
  console.log(
    JSON.stringify({
      url: `http://127.0.0.1:${address.port}/?project=demo`,
      spike: "synthetic-room-only",
    }),
  );
});
