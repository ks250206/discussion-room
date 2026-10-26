/** Native Node worker fixture: the parent holds the SQLite write lock until this opener arrives. */
import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import * as v from "valibot";
import { migrateDatabase } from "./migrations.ts";

const input: unknown = workerData;
const parsed = v.safeParse(v.strictObject({ path: v.string() }), input);
if (!parsed.success || parentPort === null) throw new Error("Invalid migration worker fixture");
const port = parentPort;

class SignallingDatabase extends DatabaseSync {
  override exec(sql: string): void {
    if (sql === "BEGIN IMMEDIATE") port.postMessage({ type: "waiting-for-lock" });
    super.exec(sql);
  }
}
const database = new SignallingDatabase(parsed.output.path, { timeout: 3000 });
try {
  port.postMessage({ type: "result", result: migrateDatabase(database) });
} finally {
  database.close();
}
