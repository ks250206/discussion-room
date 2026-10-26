import { renderToString } from "react-dom/server";
import { expect, test } from "vite-plus/test";
import { App } from "./App.tsx";

test("renders the lobby shell on the server without a connection or save claim", () => {
  const html = renderToString(<App />);

  expect(html).toContain("Discussion Room");
  expect(html).toContain("ロビー");
  expect(html).toContain("表示できるプロジェクトはありません");
  expect(html).toContain("未接続");
  expect(html).toContain("保存対象なし");
  expect(html).toContain("未起動");
  expect(html).toContain("—");
  expect(html).not.toContain("接続済み");
  expect(html).not.toContain("保存済み");
  expect(html).not.toContain("@discussion-room/domain");
});
