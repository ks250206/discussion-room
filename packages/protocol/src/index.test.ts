import { expect, test } from "vite-plus/test";
import { packageName } from "./index.ts";

test("exposes its package name", () => {
  expect(packageName).toBe("@discussion-room/protocol");
});
