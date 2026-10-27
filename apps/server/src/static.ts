import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { Context } from "hono";
import { getMimeType } from "hono/utils/mime";

/** Deployment roots are trusted; requests can only read regular files, never links/dotfiles. */
const openStaticFile = async (root: string, relative: string) => {
  const parts = relative.split("/");
  if (parts.some((part) => part === "" || part.startsWith(".") || part.includes("\\")))
    return undefined;
  let path = resolve(root);
  if ((await lstat(path)).isSymbolicLink()) return undefined;
  for (const part of parts) {
    path = join(path, part);
    const info = await lstat(path);
    if (info.isSymbolicLink()) return undefined;
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const info = await file.stat();
  if (!info.isFile()) {
    await file.close();
    return undefined;
  }
  return { file, size: info.size };
};

export const serveFile = async (
  context: Context,
  root: string,
  relative: string,
  cacheControl = "no-cache",
) => {
  let opened;
  try {
    opened = await openStaticFile(root, relative);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ENOTDIR", "ELOOP", "EACCES", "ENAMETOOLONG"].includes(String(error.code))
    )
      return undefined;
    throw error;
  }
  if (opened === undefined) return undefined;
  const { file, size } = opened;
  context.header("Content-Type", getMimeType(relative) ?? "application/octet-stream");
  context.header("Content-Length", String(size));
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Cache-Control", cacheControl);
  if (context.req.method === "HEAD") {
    await file.close();
    return context.body(null, 200);
  }
  // Node's stream closes the descriptor at EOF, on errors, and when the client aborts.
  return context.body(Readable.toWeb(file.createReadStream()));
};

/** Versioned Pyodide directories never change contents, so browsers may keep them. */
export const pyodideCacheControl = (relative: string): string =>
  /^v\d+\.\d+\.\d+\//.test(relative) ? "public, max-age=31536000, immutable" : "no-cache";

export const isNavigation = (pathname: string, accept: string): boolean =>
  extname(pathname) === "" &&
  !pathname.split("/").some((part) => part.startsWith(".")) &&
  accept.split(",").some((type) => type.trim().split(";")[0] === "text/html");
