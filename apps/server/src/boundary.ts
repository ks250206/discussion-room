import type { IncomingMessage } from "node:http";

type BoundaryResult =
  | { ok: true; pathname: string }
  | { ok: false; status: 400 | 403; error: string };

const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

const localOrigin = (input: string): URL | undefined => {
  const parsed = URL.parse(input);
  if (
    parsed === null ||
    parsed.protocol !== "http:" ||
    !localHosts.has(parsed.hostname) ||
    parsed.origin !== input
  )
    return undefined;
  return parsed;
};

/** Runs on the raw Node request, before URL normalization or WebSocket handleUpgrade. */
export const validateBoundary = (
  request: IncomingMessage,
  port: number,
  development: boolean,
): BoundaryResult => {
  const target = request.url ?? "";
  if (!target.startsWith("/") || target.startsWith("//")) {
    return { ok: false, status: 400, error: "invalid_target" };
  }
  const encodedPath = target.split("?")[0] ?? "";
  let pathname: string;
  try {
    pathname = decodeURIComponent(encodedPath);
  } catch {
    return { ok: false, status: 400, error: "invalid_path" };
  }
  if (
    /%(?:2f|5c)/i.test(encodedPath) ||
    Array.from(pathname).some(
      (character) =>
        character === "\\" || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    pathname.split("/").some((part) => part === ".." || part === ".")
  )
    return { ok: false, status: 400, error: "invalid_path" };

  const host = request.headers.host;
  const origin = host === undefined ? undefined : localOrigin(`http://${host}`);
  const hostCount = request.rawHeaders.filter(
    (value, index) => index % 2 === 0 && value.toLowerCase() === "host",
  ).length;
  if (origin === undefined || hostCount !== 1 || Number(origin.port || "80") !== port) {
    return { ok: false, status: 403, error: "invalid_host" };
  }
  const supplied = request.headers.origin;
  if (supplied !== undefined) {
    const parsed = localOrigin(supplied);
    if (parsed === undefined || (!development && parsed.origin !== origin.origin)) {
      return { ok: false, status: 403, error: "invalid_origin" };
    }
  }
  // Origin-less requests support non-browser clients. Browsers always send Origin on WS upgrades.
  return { ok: true, pathname };
};
