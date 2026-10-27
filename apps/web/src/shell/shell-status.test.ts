import { expect, test } from "vite-plus/test";
import { DEFAULT_SHELL_STATUS, resolveShellStatus } from "./shell-status.ts";

test("uses disconnected, unsaved, unknown zoom, and stopped Python by default", () => {
  expect(resolveShellStatus(undefined)).toEqual({
    connection: "未接続",
    save: "保存対象なし",
    zoom: "—",
    python: "未起動",
  });
  expect(DEFAULT_SHELL_STATUS.connection).not.toBe("接続済み");
  expect(DEFAULT_SHELL_STATUS.save).not.toBe("保存済み");
});

test("lets a caller replace individual status labels", () => {
  expect(resolveShellStatus({ connection: "表示確認" })).toEqual({
    connection: "表示確認",
    save: "保存対象なし",
    zoom: "—",
    python: "未起動",
  });
  expect(resolveShellStatus({ zoom: "" }).zoom).toBe("");
});
