// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import {
  ConnectionStatus,
  type ConnectionLocale,
  type ConnectionPhase,
} from "./ConnectionStatus.tsx";

const text = (element: HTMLElement): string =>
  (element.textContent ?? "").replace(/\s+/g, " ").trim();

afterEach(() => {
  cleanup();
});

test.each([
  ["connecting", "ja", "接続しています"],
  ["reconnecting", "ja", "再接続しています"],
  ["disconnected", "ja", "未接続"],
  ["connected", "ja", "接続済み"],
  ["connecting", "en", "Connecting"],
  ["reconnecting", "en", "Reconnecting"],
  ["disconnected", "en", "Disconnected"],
  ["connected", "en", "Connected"],
] as const)("announces %s in %s", (phase: ConnectionPhase, locale: ConnectionLocale, label) => {
  render(<ConnectionStatus phase={phase} pendingCount={0} locale={locale} />);

  const status = screen.getByRole("status");
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(status.getAttribute("aria-atomic")).toBe("true");
  expect(text(status)).toContain(label);
  expect(status.parentElement?.getAttribute("data-phase")).toBe(phase);
  expect(status.parentElement?.getAttribute("lang")).toBe(locale);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("states the pending command count in both locales", () => {
  const { rerender } = render(
    <ConnectionStatus phase="disconnected" pendingCount={0} locale="ja" />,
  );
  expect(text(screen.getByRole("status"))).toBe("接続： 未接続 確定待ち： 0件");

  rerender(<ConnectionStatus phase="reconnecting" pendingCount={1} locale="en" />);
  expect(text(screen.getByRole("status"))).toBe("Connection: Reconnecting Pending: 1 command");

  rerender(<ConnectionStatus phase="connected" pendingCount={2} locale="en" />);
  expect(text(screen.getByRole("status"))).toBe("Connection: Connected Pending: 2 commands");

  rerender(<ConnectionStatus phase="connecting" pendingCount={2} locale="ja" />);
  expect(text(screen.getByRole("status"))).toBe("接続： 接続しています 確定待ち： 2件");
});

test("does not replace a non-finite pending count with zero", () => {
  render(<ConnectionStatus phase="connected" pendingCount={Number.NaN} locale="ja" />);
  const status = text(screen.getByRole("status"));
  expect(status).toContain("NaN件");
  expect(status).not.toContain("0件");
});

test("distinguishes disconnected and reconnecting marks without relying on color alone", () => {
  const { rerender } = render(
    <ConnectionStatus phase="disconnected" pendingCount={0} locale="ja" />,
  );
  expect(
    screen.getByRole("status").querySelector("[aria-hidden='true']")?.getAttribute("class"),
  ).toContain("rounded-sm");

  rerender(<ConnectionStatus phase="reconnecting" pendingCount={0} locale="en" />);
  expect(
    screen.getByRole("status").querySelector("[aria-hidden='true']")?.getAttribute("class"),
  ).toContain("border-2");

  rerender(<ConnectionStatus phase="connected" pendingCount={0} locale="en" />);
  expect(
    screen.getByRole("status").querySelector("[aria-hidden='true']")?.getAttribute("class"),
  ).toContain("rounded-full");
});

test("shows a rejection alert without folding it into the connection status", () => {
  const { rerender } = render(<ConnectionStatus phase="connected" pendingCount={1} locale="ja" />);
  expect(screen.queryByRole("alert")).toBeNull();

  rerender(<ConnectionStatus phase="connected" pendingCount={1} rejection="" locale="ja" />);
  expect(screen.queryByRole("alert")).toBeNull();

  rerender(<ConnectionStatus phase="connected" pendingCount={1} rejection="   " locale="en" />);
  expect(screen.queryByRole("alert")).toBeNull();

  rerender(
    <ConnectionStatus
      phase="disconnected"
      pendingCount={2}
      rejection="変更を保存できませんでした。"
      locale="ja"
    />,
  );
  expect(text(screen.getByRole("alert"))).toBe("拒否： 変更を保存できませんでした。");
  expect(text(screen.getByRole("status"))).toBe("接続： 未接続 確定待ち： 2件");
  expect(text(screen.getByRole("status"))).not.toContain("変更を保存できませんでした。");

  rerender(
    <ConnectionStatus
      phase="connected"
      pendingCount={0}
      rejection="  version conflict  "
      locale="en"
    />,
  );
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("  version conflict  ");
  expect(text(alert)).toBe("Rejected: version conflict");
});
