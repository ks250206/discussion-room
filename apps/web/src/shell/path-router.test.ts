import { expect, test } from "vite-plus/test";
import {
  isLayoutPreview,
  LAYOUT_PREVIEW_PATH,
  normalizeAppPath,
  parseRoute,
} from "./path-router.ts";

test("parses lobby, project, and board paths", () => {
  expect(parseRoute("/")).toEqual({ kind: "lobby" });
  expect(parseRoute("/lobby")).toEqual({ kind: "lobby" });
  expect(parseRoute("/lobby/")).toEqual({ kind: "lobby" });
  expect(parseRoute("/project/alpha")).toEqual({ kind: "project", projectId: "alpha" });
  expect(parseRoute("/project/alpha/")).toEqual({ kind: "project", projectId: "alpha" });
  expect(parseRoute("/project/alpha/board/beta")).toEqual({
    kind: "board",
    projectId: "alpha",
    boardId: "beta",
  });
  expect(parseRoute("/project/room%201/board/board%202")).toEqual({
    kind: "board",
    projectId: "room 1",
    boardId: "board 2",
  });
});

test("rejects unknown, incomplete, and unsafe path segments", () => {
  expect(parseRoute("/missing")).toEqual({ kind: "unknown", path: "/missing" });
  expect(parseRoute("/project")).toEqual({ kind: "unknown", path: "/project" });
  expect(parseRoute("/project/alpha/board")).toEqual({
    kind: "unknown",
    path: "/project/alpha/board",
  });
  expect(parseRoute("/project/alpha/extra")).toEqual({
    kind: "unknown",
    path: "/project/alpha/extra",
  });
  expect(parseRoute("/project/.")).toEqual({ kind: "unknown", path: "/project/." });
  expect(parseRoute("/project/..")).toEqual({ kind: "unknown", path: "/project/.." });
  expect(parseRoute("/project/%E0%A4%A")).toEqual({
    kind: "unknown",
    path: "/project/%E0%A4%A",
  });
});

test("recognizes the layout preview route", () => {
  const route = parseRoute(LAYOUT_PREVIEW_PATH);
  expect(route).toEqual({
    kind: "board",
    projectId: "layout-preview",
    boardId: "layout-preview",
  });
  expect(isLayoutPreview(route)).toBe(true);
  expect(isLayoutPreview({ kind: "project", projectId: "alpha" })).toBe(false);
  expect(isLayoutPreview({ kind: "lobby" })).toBe(false);
  expect(
    isLayoutPreview({ kind: "board", projectId: "real-project", boardId: "layout-preview" }),
  ).toBe(false);
  expect(
    isLayoutPreview({ kind: "board", projectId: "layout-preview", boardId: "real-board" }),
  ).toBe(false);
});

test("normalizes in-app paths and drops foreign URLs", () => {
  expect(normalizeAppPath("/project/alpha/board/beta?x=1")).toBe("/project/alpha/board/beta");
  expect(normalizeAppPath("/lobby/")).toBe("/lobby/");
  expect(normalizeAppPath("//evil.example/project/alpha")).toBeNull();
  expect(normalizeAppPath("https://evil.example/project/alpha")).toBeNull();
  expect(normalizeAppPath("project/alpha")).toBeNull();
});

test("rejects decoded URL separators and control characters in either route ID", () => {
  for (const id of ["a%2Fb", "a%5Cb", "%00", "%1F", "%7F", "%C2%85"]) {
    for (const path of [`/project/${id}`, `/project/alpha/board/${id}`]) {
      expect(parseRoute(path)).toEqual({ kind: "unknown", path });
    }
  }
});
