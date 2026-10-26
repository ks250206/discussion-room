import { renderToString } from "react-dom/server";
import { expect, test } from "vite-plus/test";
import { App } from "./App.tsx";

test("renders the domain package name", () => {
  expect(renderToString(<App />)).toContain("@discussion-room/domain");
});
