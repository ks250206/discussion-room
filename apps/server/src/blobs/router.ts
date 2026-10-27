import { Hono } from "hono";
import type { BlobError, BlobStore } from "./store.ts";

const status = (code: BlobError["code"]) => {
  switch (code) {
    case "forbidden":
      return 403;
    case "invalid_metadata":
      return 400;
    case "unsupported_mime":
      return 415;
    case "too_large":
      return 413;
    case "not_found":
      return 404;
    case "aborted":
      return 400;
    case "closed":
      return 503;
    case "corrupt_content":
    case "storage_failure":
      return 500;
  }
  return 500;
};

export const contentDisposition = (filename: string): string => {
  const fallback = filename.replace(/[^a-zA-Z0-9._ -]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

/** Mount explicitly only after Host/Origin and trusted project authorization are connected. */
export const createBlobRouter = (store: BlobStore): Hono => {
  const app = new Hono();
  app.use("*", async (context, next) => {
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Cache-Control", "no-store");
    await next();
  });
  app.post("/projects/:projectId/blobs", async (context) => {
    const result = await store.upload(context.req.param("projectId"), context.req.raw);
    return result.ok
      ? context.json(result.value, result.value.deduplicated ? 200 : 201)
      : context.json({ error: result.error.code }, status(result.error.code));
  });
  app.get("/projects/:projectId/blobs/:sha256", async (context) => {
    const result = await store.download(
      context.req.param("projectId"),
      context.req.param("sha256"),
      context.req.raw,
    );
    if (!result.ok) return context.json({ error: result.error.code }, status(result.error.code));
    const { metadata, bytes } = result.value;
    context.header("Content-Type", metadata.mime);
    context.header("Content-Length", String(metadata.size));
    context.header("Content-Disposition", contentDisposition(metadata.filename));
    if (context.req.method === "HEAD") return context.body(null);
    return context.body(bytes);
  });
  app.onError((_error, context) => context.json({ error: "storage_failure" }, 500));
  return app;
};
