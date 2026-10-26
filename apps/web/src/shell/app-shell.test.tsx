// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { App } from "../App.tsx";

const inspector = (): HTMLElement => {
  const element = document.getElementById("inspector");
  if (element === null) {
    throw new Error("inspector not found");
  }
  return element;
};

beforeEach(() => {
  window.innerWidth = 1280;
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("lobby has no projects and a labeled layout preview", async () => {
  const user = userEvent.setup();
  render(<App />);

  expect(screen.getByRole("heading", { level: 1, name: "ロビー" })).toBeTruthy();
  expect(screen.getByText("表示できるプロジェクトはありません")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /作成/ })).toBeNull();
  expect(screen.getByRole("link", { name: "本文へスキップ" }).getAttribute("href")).toBe("#main");

  await user.click(screen.getByRole("link", { name: "レイアウトプレビュー" }));

  expect(screen.getByRole("heading", { level: 1, name: "ボード" })).toBeTruthy();
  expect(
    screen.getByText("これは画面レイアウトの見本です。研究データではありません。"),
  ).toBeTruthy();
  expect(screen.getAllByText("layout-preview")).toHaveLength(2);
  expect(screen.getByText("キャンバスはまだありません")).toBeTruthy();
});

test("follows a deep link and the browser back and forward stack", async () => {
  window.history.replaceState(null, "", "/project/alpha/board/beta");
  const user = userEvent.setup();
  render(<App />);

  expect(screen.getByRole("heading", { level: 1, name: "ボード" })).toBeTruthy();
  expect(screen.getByText("alpha")).toBeTruthy();
  expect(screen.getByText("beta")).toBeTruthy();
  expect(window.location.pathname).toBe("/project/alpha/board/beta");

  await user.click(screen.getByRole("link", { name: "ロビーへ戻る" }));
  expect(screen.getByRole("heading", { level: 1, name: "ロビー" })).toBeTruthy();
  expect(window.location.pathname).toBe("/");

  window.history.back();
  await waitFor(() => {
    expect(screen.getByRole("heading", { level: 1, name: "ボード" })).toBeTruthy();
  });
  expect(screen.getByText("alpha")).toBeTruthy();

  window.history.forward();
  await waitFor(() => {
    expect(screen.getByRole("heading", { level: 1, name: "ロビー" })).toBeTruthy();
  });
});

test("shows a direct project route and an unknown-route fallback", () => {
  window.history.replaceState(null, "", "/project/room%201");
  render(<App />);
  expect(screen.getByRole("heading", { level: 1, name: "プロジェクト" })).toBeTruthy();
  expect(screen.getByText("room 1")).toBeTruthy();
  expect(screen.getByText("ボードをまだ読み込んでいません")).toBeTruthy();
  cleanup();

  window.history.replaceState(null, "", "/missing");
  render(<App />);
  expect(screen.getByRole("heading", { level: 1, name: "ページが見つかりません" })).toBeTruthy();
  expect(screen.getByText("開いたアドレス /missing")).toBeTruthy();
  const main = document.getElementById("main");
  if (main === null) {
    throw new Error("main not found");
  }
  expect(within(main).getByRole("link", { name: "ロビーへ戻る" })).toBeTruthy();
});

test("keeps editing tools disabled and status disconnected by default", () => {
  render(<App />);

  const selectTool = screen.getByRole("button", { name: /選択/ });
  expect(
    selectTool.hasAttribute("disabled") || selectTool.getAttribute("aria-disabled") === "true",
  ).toBe(true);
  expect(screen.getByText("編集はまだできません")).toBeTruthy();
  expect(screen.getByText("これらの操作はまだできません")).toBeTruthy();
  expect(screen.getByText("未接続")).toBeTruthy();
  expect(screen.getByText("保存対象なし")).toBeTruthy();
  expect(screen.getByText("未起動")).toBeTruthy();
  expect(screen.getByText("—")).toBeTruthy();
  expect(screen.queryByText("接続済み")).toBeNull();
  expect(screen.queryByText("保存済み")).toBeNull();
});

test("status props can replace the default labels", () => {
  render(<App status={{ connection: "表示確認", zoom: "125%" }} />);

  expect(screen.getByText("表示確認")).toBeTruthy();
  expect(screen.getByText("125%")).toBeTruthy();
  expect(screen.getByText("保存対象なし")).toBeTruthy();
  expect(screen.getByText("未起動")).toBeTruthy();
  expect(screen.queryByText("未接続")).toBeNull();
});

test("toggles the inspector and keeps the hidden panel out of the tab order", async () => {
  const user = userEvent.setup();
  render(<App />);

  const openToggle = screen.getByRole("button", { name: "インスペクターを隠す" });
  expect(openToggle.getAttribute("aria-expanded")).toBe("true");
  expect(openToggle.getAttribute("aria-controls")).toBe("inspector");
  expect(document.querySelector(".app-shell")?.getAttribute("data-layout")).toBe("columns");

  await user.click(openToggle);

  const closedToggle = screen.getByRole("button", { name: "インスペクターを表示" });
  expect(closedToggle.getAttribute("aria-expanded")).toBe("false");
  expect(inspector().hasAttribute("hidden")).toBe(true);
  expect(inspector().hasAttribute("inert")).toBe(true);
  const hiddenLink = inspector().querySelector("a");
  expect(hiddenLink).not.toBeNull();
  hiddenLink?.focus();
  expect(document.activeElement).not.toBe(hiddenLink);

  await user.keyboard("{Escape}");
  expect(
    screen.getByRole("button", { name: "インスペクターを表示" }).getAttribute("aria-expanded"),
  ).toBe("false");
});

test("mobile inspector is a modal with keyboard containment, escape, and focus restoration", async () => {
  window.innerWidth = 400;
  const user = userEvent.setup();
  render(<App />);

  expect(document.querySelector(".app-shell")?.getAttribute("data-layout")).toBe("overlay");
  expect(screen.queryByRole("dialog")).toBeNull();
  const showToggle = screen.getByRole("button", { name: "インスペクターを表示" });
  expect(showToggle.getAttribute("aria-expanded")).toBe("false");

  await user.click(showToggle);

  const dialog = screen.getByRole("dialog", { name: "インスペクター" });
  const close = within(dialog).getByRole("button", { name: "閉じる" });
  const lobby = within(dialog).getByRole("link", { name: "ロビーへ戻る" });
  expect(dialog.id).toBe("inspector");
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(document.querySelector(".app-shell")?.hasAttribute("inert")).toBe(true);
  await waitFor(() => {
    expect(document.activeElement).toBe(close);
  });

  await user.tab();
  expect(document.activeElement).toBe(lobby);
  await user.tab();
  expect(document.activeElement).toBe(close);
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(lobby);

  await user.keyboard("{Escape}");

  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  expect(showToggle.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(showToggle);
  expect(document.querySelector(".app-shell")?.hasAttribute("inert")).toBe(false);

  await user.click(showToggle);
  await user.click(screen.getByRole("button", { name: "閉じる" }));
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  expect(document.activeElement).toBe(showToggle);
  expect(document.querySelector("[data-base-ui-inert]")).toBeNull();

  await user.click(showToggle);
  const backdrop = document.querySelector<HTMLElement>(".app-shell__backdrop");
  if (backdrop === null) {
    throw new Error("backdrop not found");
  }
  await user.click(backdrop);
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  expect(document.activeElement).toBe(showToggle);
  expect(document.querySelector(".app-shell")?.hasAttribute("inert")).toBe(false);
});

test("resizing an open mobile inspector removes modal behavior and keeps the desktop panel", async () => {
  window.innerWidth = 400;
  const user = userEvent.setup();
  render(<App />);
  // Happy DOM's media-query change listener initializes its cached match to false.
  window.dispatchEvent(new Event("resize"));
  await user.click(screen.getByRole("button", { name: "インスペクターを表示" }));
  expect(screen.getByRole("dialog", { name: "インスペクター" })).toBeTruthy();

  window.innerWidth = 1280;
  window.dispatchEvent(new Event("resize"));
  await waitFor(() => {
    expect(document.querySelector(".app-shell")?.getAttribute("data-layout")).toBe("columns");
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("complementary", { name: "インスペクター" })).toBeTruthy();
  expect(document.querySelector(".app-shell")?.hasAttribute("inert")).toBe(false);
  expect(document.querySelector("[data-base-ui-inert]")).toBeNull();
  const toggle = screen.getByRole("button", { name: "インスペクターを隠す" });
  await waitFor(() => {
    expect(document.activeElement).toBe(toggle);
  });

  window.innerWidth = 400;
  window.dispatchEvent(new Event("resize"));
  await waitFor(() => {
    expect(document.querySelector(".app-shell")?.getAttribute("data-layout")).toBe("overlay");
  });
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  expect(screen.getByRole("button", { name: "インスペクターを表示" })).toBeTruthy();
  expect(document.querySelector(".app-shell")?.hasAttribute("inert")).toBe(false);
});

test("renders the desktop fallback when matchMedia is unavailable", () => {
  vi.stubGlobal("matchMedia", undefined);
  render(<App />);

  expect(document.querySelector(".app-shell")?.getAttribute("data-layout")).toBe("columns");
  expect(screen.getByRole("complementary", { name: "インスペクター" })).toBeTruthy();
});
