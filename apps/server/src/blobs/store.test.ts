import { createHash } from "node:crypto";
import { createServer, request as httpRequest, type Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { err, IdSchema, validate, type Result } from "@discussion-room/domain";
import {
  BlobFilenameSchema,
  openSqliteRepository,
  validateProjectState,
  type ProjectState,
  type Repository,
} from "../repository/index.ts";
import { createAppServer } from "../app.ts";
import { createBlobStore, type BlobAuthorizer, type BlobStore } from "./store.ts";
import { createBlobRouter } from "./router.ts";

// Partial filesystem mock keeps real I/O and lets this suite exercise an unlink failure
// after SQLite has actually committed, without relying on OS-user permission differences.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, unlink: vi.fn<typeof actual.unlink>(actual.unlink) };
});

function success<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
const id = (n: number) =>
  success(validate(IdSchema, `01ARZ3NDEKTSV4RRFFQ69G${String(n).padStart(4, "0")}`));
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function state(n: number): ProjectState {
  return success(
    validateProjectState({
      schemaVersion: 1,
      graph: {
        entities: {
          projects: [
            {
              id: id(n),
              title: "Synthetic",
              description: "",
              createdAt: "2026-10-27T00:00:00.000Z",
              version: 1,
            },
          ],
          boards: [],
          artifacts: [],
          revisions: [],
          canvasItems: [],
        },
        itemPorts: [],
        semanticRelations: [],
        dataflowEdges: [],
        visualConnectors: [],
      },
      blobs: [],
      executionRecords: [],
      provenance: [],
      snapshots: [],
    }),
  );
}
function commit(repository: Repository, next: ProjectState, seq = 0, command = 100) {
  return repository.commit({
    projectId: next.graph.entities.projects[0]?.id,
    expectedSeq: seq,
    state: next,
    event: {
      commandId: id(command),
      actor: "trusted-test",
      createdAt: "2026-10-27T00:00:00.000Z",
      payload: {},
    },
    audit: { reason: "synthetic setup", payload: {} },
  });
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});
async function fixture(
  options: {
    maximum?: number;
    authorize?: BlobAuthorizer | false;
    repository?: (repository: Repository) => Repository;
  } = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "discussion-blobs-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const database = join(root, "db.sqlite");
  const repository = success(openSqliteRepository(database));
  cleanups.push(async () => {
    repository.close();
  });
  success(commit(repository, state(1)));
  success(commit(repository, state(2), 0, 101));
  const store = success(
    await createBlobStore({
      dataDir: root,
      maxSizeBytes: options.maximum ?? 64,
      repository: options.repository?.(repository) ?? repository,
      ...(options.authorize === false ? {} : { authorize: options.authorize ?? (() => true) }),
    }),
  );
  cleanups.push(() => store.close());
  const app = new Hono().route("/api", createBlobRouter(store));
  return { root, database, repository, store, app };
}
function request(
  bytes: string | Uint8Array = "a,b\n1,2\n",
  filename = "測定.csv",
  mime = "text/csv",
) {
  return new Request("http://localhost/upload", {
    method: "POST",
    body: bytes,
    headers: { "x-blob-filename": encodeURIComponent(filename), "content-type": mime },
  });
}
async function upload(store: BlobStore, bytes = "a,b\n1,2\n", project = 1, name = "測定.csv") {
  return success(await store.upload(id(project), request(bytes, name))).metadata;
}
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return `http://127.0.0.1:${address.port}`;
}

describe("content-addressed Project resource registry", () => {
  test("factory requires an explicit bounded configuration; filename schema preserves Unicode pairs", async () => {
    const { root, repository } = await fixture();
    for (const maximum of [0, -1, 1.5, Number.NaN, 64 * 1024 * 1024 + 1]) {
      expect(
        await createBlobStore({
          dataDir: join(root, "uncreated"),
          repository,
          maxSizeBytes: maximum,
        }),
      ).toEqual(err({ code: "invalid_metadata" }));
    }
    expect(await createBlobStore({ dataDir: "", repository, maxSizeBytes: 1 })).toEqual(
      err({ code: "invalid_metadata" }),
    );
    expect(await createBlobStore({ dataDir: "relative", repository, maxSizeBytes: 1 })).toEqual(
      err({ code: "invalid_metadata" }),
    );
    await symlink(root, join(root, "linked-root"));
    expect(
      await createBlobStore({ dataDir: join(root, "linked-root"), repository, maxSizeBytes: 1 }),
    ).toEqual(err({ code: "storage_failure" }));
    expect(validate(BlobFilenameSchema, "sample-🧪.csv").ok).toBe(true);
    for (const name of [
      "",
      "bad\uD800.csv",
      "bad\uDFFF.csv",
      "bad\u0085.csv",
      "bad\u202E.csv",
      "bad\u200B.csv",
    ]) {
      expect(validate(BlobFilenameSchema, name).ok).toBe(false);
    }
  });

  test("streams raw bytes over real HTTP; exact download, safe Unicode headers and HEAD", async () => {
    const { app, root } = await fixture();
    const listener = getRequestListener(app.fetch, { overrideGlobalObjects: false });
    const base = await listen(
      createServer((req, res) => {
        void listener(req, res);
      }),
    );
    const bytes = Buffer.from("α,missing,decimal\r\n1,,112.00\r\n");
    const response = await fetch(`${base}/api/projects/${id(1)}/blobs`, {
      method: "POST",
      headers: request("", "測定 'v1'.csv").headers,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 4));
          controller.enqueue(bytes.subarray(4));
          controller.close();
        },
      }),
      duplex: "half",
    });
    expect(response.status).toBe(201);
    const metadata: unknown = await response.json();
    expect(metadata).toMatchObject({
      deduplicated: false,
      metadata: {
        sha256: hash(bytes),
        size: bytes.length,
        filename: "測定 'v1'.csv",
        mime: "text/csv",
      },
    });
    expect(await readFile(join(root, "blobs", hash(bytes)))).toEqual(bytes);
    const download = await fetch(`${base}/api/projects/${id(1)}/blobs/${hash(bytes)}`);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    expect(download.headers.get("content-type")).toBe("text/csv");
    expect(download.headers.get("content-length")).toBe(String(bytes.length));
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(download.headers.get("cache-control")).toBe("no-store");
    expect(download.headers.get("content-disposition")).toContain("attachment; filename=");
    expect(download.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''%E6%B8%AC%E5%AE%9A%20%27v1%27.csv",
    );
    const head = await fetch(download.url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-length")).toBe(String(bytes.length));
  });

  test("real HTTP chunked upload enforces the streamed limit and abort cleanup", async () => {
    const { app, root, repository } = await fixture({ maximum: 8 });
    const listener = getRequestListener(app.fetch, { overrideGlobalObjects: false });
    const base = await listen(
      createServer((req, res) => {
        void listener(req, res);
      }),
    );
    const response = await fetch(`${base}/api/projects/${id(1)}/blobs`, {
      method: "POST",
      headers: request().headers,
      body: new ReadableStream({
        start(writer) {
          writer.enqueue(new TextEncoder().encode("12345"));
          writer.enqueue(new TextEncoder().encode("6789"));
          writer.close();
        },
      }),
      duplex: "half",
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too_large" });
    await new Promise<void>((resolve) => {
      const incoming = httpRequest(`${base}/api/projects/${id(1)}/blobs`, {
        method: "POST",
        headers: { "x-blob-filename": "x.csv", "content-type": "text/csv" },
      });
      incoming.on("error", () => resolve());
      incoming.write("123");
      setTimeout(() => incoming.destroy(new Error("test abort")), 20);
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await readdir(join(root, "blobs"))).length === 0) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    expect(await readdir(join(root, "blobs"))).toEqual([]);
    expect(success(repository.readProject(id(1)))?.state.blobs).toEqual([]);
  });

  test("actual SQLite insert failure rolls back metadata while preserving orphan bytes", async () => {
    const { database, store, root, repository } = await fixture();
    const db = new DatabaseSync(database);
    db.exec(
      "CREATE TRIGGER fail_blob BEFORE INSERT ON blobs BEGIN SELECT RAISE(ABORT, 'synthetic database failure'); END",
    );
    db.close();
    expect(await store.upload(id(1), request("orphan"))).toEqual(err({ code: "storage_failure" }));
    expect(success(repository.readProject(id(1)))?.state.blobs).toEqual([]);
    expect(success(repository.eventsAfter(id(1), 0))).toHaveLength(1);
    expect(await readdir(join(root, "blobs"))).toEqual([hash("orphan")]);
  });

  test("lowering the upload limit keeps larger saved content readable", async () => {
    const { root, repository, store } = await fixture();
    const bytes = "0123456789";
    const blob = await upload(store, bytes);
    const limited = success(
      await createBlobStore({ dataDir: root, repository, maxSizeBytes: 4, authorize: () => true }),
    );
    cleanups.push(() => limited.close());
    expect(await limited.upload(id(1), request(bytes))).toEqual(err({ code: "too_large" }));
    const download = success(await limited.download(id(1), blob.sha256, request()));
    expect(download.metadata).toEqual(blob);
    expect(download.bytes).toEqual(new TextEncoder().encode(bytes));
    const app = createBlobRouter(limited);
    const response = await app.request(`/projects/${id(1)}/blobs/${blob.sha256}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(bytes);
  });

  test("deduplicated HTTP response identifies the original filename and MIME explicitly", async () => {
    const { app, repository } = await fixture();
    const first = await app.request(
      `/api/projects/${id(1)}/blobs`,
      request("a,b", "data.bin", "application/octet-stream"),
    );
    expect(first.status).toBe(201);
    const original: unknown = await first.json();
    expect(original).toMatchObject({
      deduplicated: false,
      metadata: { filename: "data.bin", mime: "application/octet-stream" },
    });
    const repeated = await app.request(
      `/api/projects/${id(1)}/blobs`,
      request("a,b", "測定.csv", "text/csv"),
    );
    expect(repeated.status).toBe(200);
    const reused: unknown = await repeated.json();
    expect(reused).toMatchObject({
      deduplicated: true,
      metadata: { filename: "data.bin", mime: "application/octet-stream" },
    });
    const current = success(repository.readProject(id(1)));
    expect(current?.state.blobs).toHaveLength(1);
    expect(reused).toEqual({ deduplicated: true, metadata: current?.state.blobs[0] });
  });

  test("cleanup failure keeps committed success and an unserved temporary for future recovery", async () => {
    const { store, repository, root, app } = await fixture();
    vi.mocked(unlink).mockRejectedValueOnce(new Error("synthetic unlink failure"));
    const created = await store.upload(id(1), request("cleanup"));
    const registration = success(created);
    expect(registration.deduplicated).toBe(false);
    expect(success(repository.readBlob(id(1), hash("cleanup")))).toEqual(registration.metadata);
    const entries = await readdir(join(root, "blobs"));
    expect(entries).toContain(hash("cleanup"));
    const temporary = entries.find((entry) => entry.startsWith(".upload-"));
    expect(temporary).toBeDefined();
    if (!temporary) throw new Error("Missing failed-cleanup temporary");
    expect((await app.request(`/api/projects/${id(1)}/blobs/${temporary}`)).status).toBe(400);
    expect(success(await store.download(id(1), hash("cleanup"), request())).bytes).toEqual(
      new TextEncoder().encode("cleanup"),
    );
    const retry = success(await store.upload(id(1), request("cleanup")));
    expect(retry).toEqual({ metadata: registration.metadata, deduplicated: true });
    vi.mocked(unlink).mockRejectedValueOnce(new Error("synthetic error-path cleanup failure"));
    expect(await store.upload(id(1), request("x".repeat(65)))).toEqual(err({ code: "too_large" }));
    expect(success(repository.readProject(id(1)))?.state.blobs).toEqual([registration.metadata]);
  });

  test("same Project duplicates and concurrent writers keep one immutable metadata row and one physical file", async () => {
    const { root, store, repository } = await fixture();
    const first = await upload(store);
    const duplicates = await Promise.all(
      Array.from({ length: 5 }, () => upload(store, "a,b\n1,2\n", 1, "other.csv")),
    );
    expect(duplicates).toEqual(Array.from({ length: 5 }, () => first));
    expect(await readdir(join(root, "blobs"))).toEqual([first.sha256]);
    const project = success(repository.readProject(id(1)));
    expect(project?.state.blobs).toEqual([first]);
    expect(project?.seq).toBe(1);
    expect(success(repository.eventsAfter(id(1), 0))).toHaveLength(1);
    expect(success(repository.readAudit(id(1)))).toHaveLength(1);
  });

  test("separate connections deduplicate metadata atomically", async () => {
    const { root, store, database } = await fixture();
    const other = success(openSqliteRepository(database));
    cleanups.push(async () => {
      other.close();
    });
    const second = success(
      await createBlobStore({
        dataDir: root,
        repository: other,
        maxSizeBytes: 64,
        authorize: () => true,
      }),
    );
    cleanups.push(() => second.close());
    const [a, b] = await Promise.all([
      store.upload(id(1), request()).then(success),
      second.upload(id(1), request()).then(success),
    ]);
    expect(a.metadata).toEqual(b.metadata);
    expect(
      [a.deduplicated, b.deduplicated].toSorted((left, right) => Number(left) - Number(right)),
    ).toEqual([false, true]);
  });

  test("cross Project deduplicates only physical bytes and prevents hash-based existence leaks", async () => {
    const { root, store, app } = await fixture({
      authorize: ({ request: incoming }) => incoming.headers.get("x-deny") !== "yes",
    });
    const first = await upload(store);
    const missing = await app.request(`/api/projects/${id(2)}/blobs/${first.sha256}`);
    expect(missing.status).toBe(404);
    const denied = await app.request(`/api/projects/${id(1)}/blobs/${first.sha256}`, {
      headers: { "x-deny": "yes" },
    });
    expect(denied.status).toBe(403);
    const second = await upload(store, "a,b\n1,2\n", 2, "separate.csv");
    expect(second.projectId).toBe(id(2));
    expect(second.id).not.toBe(first.id);
    expect(second.filename).toBe("separate.csv");
    expect(await readdir(join(root, "blobs"))).toEqual([first.sha256]);
  });

  test("default deny, unknown Project, throwing authorizer and unmounted main", async () => {
    const { store, root } = await fixture({ authorize: false });
    expect(await store.upload(id(1), request())).toEqual(err({ code: "forbidden" }));
    expect(await store.download(id(1), hash(""), request())).toEqual(err({ code: "forbidden" }));
    expect(await readdir(join(root, "blobs"))).toEqual([]);
    const trusted = await fixture();
    expect(await trusted.store.upload(id(99), request())).toEqual(err({ code: "not_found" }));
    const throwing = await fixture({
      authorize: () => {
        throw new Error("secret");
      },
    });
    expect(await throwing.store.upload(id(1), request())).toEqual(err({ code: "forbidden" }));
    const base = await listen(createAppServer({ logger: () => undefined }));
    expect(
      (await fetch(`${base}/api/projects/${id(1)}/blobs`, { method: "POST", body: "secret" }))
        .status,
    ).toBe(404);
  });

  test("empty file and exact size limit preserve raw bytes", async () => {
    const { root, store } = await fixture({ maximum: 8 });
    const empty = await upload(store, "");
    expect(empty.size).toBe(0);
    expect(await readFile(join(root, "blobs", empty.sha256))).toEqual(Buffer.alloc(0));
    expect((await upload(store, "12345678")).size).toBe(8);
    expect(await store.upload(id(1), request("123456789"))).toEqual(err({ code: "too_large" }));
    expect((await readdir(join(root, "blobs"))).toSorted()).toEqual(
      [hash(""), hash("12345678")].toSorted(),
    );
  });

  test.each([
    "../x.csv",
    "a/b.csv",
    "a\\b.csv",
    ".",
    "..",
    ".secret",
    "bad\r\nname.csv",
    "a\0b.csv",
    "C:foo.csv",
    " spaced.csv",
    "a".repeat(241),
  ])("rejects filename %j without files or metadata", async (name) => {
    const { root, store, repository } = await fixture();
    expect(await store.upload(id(1), request("x", name))).toEqual(
      err({ code: "invalid_metadata" }),
    );
    expect(await readdir(join(root, "blobs"))).toEqual([]);
    expect(success(repository.readProject(id(1)))?.state.blobs).toEqual([]);
  });

  test.each([
    "image/svg+xml",
    "text/html",
    "application/javascript",
    "text/csv; charset=utf-8",
    "made/up",
  ])("rejects unsupported MIME %s", async (mime) => {
    const { store, root } = await fixture();
    expect(await store.upload(id(1), request("<svg/>", "x.svg", mime))).toEqual(
      err({ code: "unsupported_mime" }),
    );
    expect(await readdir(join(root, "blobs"))).toEqual([]);
  });

  test("checks image signatures and fatal UTF8 without parsing science or normalizing text", async () => {
    const { store } = await fixture();
    for (const mime of ["image/png", "image/jpeg"]) {
      expect(await store.upload(id(1), request("not an image", "x.png", mime))).toEqual(
        err({ code: "unsupported_mime" }),
      );
    }
    expect(await store.upload(id(1), request(new Uint8Array([0xff]), "x.csv"))).toEqual(
      err({ code: "unsupported_mime" }),
    );
    expect(await store.upload(id(1), request("a\0b", "x.csv"))).toEqual(
      err({ code: "unsupported_mime" }),
    );
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(
      success(await store.upload(id(1), request(png, "x.png", "image/png"))).metadata.mime,
    ).toBe("image/png");
    expect(
      success(
        await store.upload(
          id(1),
          request(new Uint8Array([0xff, 0, 1]), "x.out", "application/octet-stream"),
        ),
      ).metadata.size,
    ).toBe(3);
    expect(
      success(await store.upload(id(1), request("not scientific CIF", "x.cif", "chemical/x-cif")))
        .metadata.mime,
    ).toBe("chemical/x-cif");
  });

  test("rejects malformed headers, invalid Project/hash and size hints; errors remain bounded", async () => {
    const { app, root } = await fixture();
    for (const headers of [
      { "content-type": "text/csv", "x-blob-filename": "%ZZ" },
      { "content-type": "text/csv", "x-blob-filename": "x.csv", "content-length": "-1" },
      { "content-type": "text/csv", "x-blob-filename": "x.csv", "content-length": "999" },
      { "content-type": "text/csv", "x-blob-filename": "x.csv", "content-length": "4" },
    ]) {
      const result = await app.request(`/api/projects/${id(1)}/blobs`, {
        method: "POST",
        body: "abc",
        headers,
      });
      expect([400, 413]).toContain(result.status);
      expect((await result.text()).length).toBeLessThan(80);
    }
    expect((await app.request(`/api/projects/invalid/blobs/${hash("x")}`)).status).toBe(400);
    expect((await app.request(`/api/projects/${id(1)}/blobs/%2E%2E%2Fsecret`)).status).toBe(400);
    expect(await readdir(join(root, "blobs"))).toEqual([]);
  });

  test("graph commit retains newly registered resources without weakening opaque history", async () => {
    const { repository, store } = await fixture();
    const stale = success(repository.readProject(id(1)));
    if (!stale) throw new Error("Missing project");
    const blob = await upload(store);
    success(commit(repository, stale.state, stale.seq, 102));
    expect(success(repository.readProject(id(1)))?.state.blobs).toEqual([blob]);
    const current = success(repository.readProject(id(1)));
    if (!current) throw new Error("Missing project");
    expect(
      commit(
        repository,
        { ...current.state, blobs: [{ ...blob, filename: "changed.csv" }] },
        current.seq,
        103,
      ).ok,
    ).toBe(false);
    const opaque = {
      id: id(201),
      projectId: id(1),
      schemaVersion: 1 as const,
      validation: "opaque-unverified" as const,
      source: { original: true },
      payload: { sha256: "never-trusted" },
    };
    success(
      commit(
        repository,
        { ...current.state, blobs: [...current.state.blobs, opaque] },
        current.seq,
        104,
      ),
    );
    expect(commit(repository, current.state, current.seq + 1, 105).ok).toBe(false);
  });

  test("database failure leaves only safe unreferenced bytes and does not delete another registration", async () => {
    const { root, store, repository } = await fixture({
      repository: (original) => ({
        ...original,
        registerBlob: () => err({ code: "storage_failure", message: "/private/secret path" }),
      }),
    });
    expect(await store.upload(id(1), request("orphan"))).toEqual(err({ code: "storage_failure" }));
    expect(await readdir(join(root, "blobs"))).toEqual([hash("orphan")]);
    expect(success(repository.readProject(id(1)))?.state.blobs).toEqual([]);
    expect(await store.download(id(1), hash("orphan"), request())).toEqual(
      err({ code: "not_found" }),
    );
    const trusted = success(
      await createBlobStore({ dataDir: root, repository, maxSizeBytes: 64, authorize: () => true }),
    );
    cleanups.push(() => trusted.close());
    const shared = await upload(trusted, "orphan");
    expect(await store.upload(id(1), request("orphan"))).toEqual(err({ code: "storage_failure" }));
    expect(success(await trusted.download(id(1), shared.sha256, request())).bytes).toEqual(
      new TextEncoder().encode("orphan"),
    );
  });

  test("symlinked hash paths, directories and corrupt/missing disk content never download successfully", async () => {
    const { root, store, repository, app } = await fixture();
    const blob = await upload(store, "original");
    const path = join(root, "blobs", blob.sha256);
    await writeFile(path, "tampered");
    expect(await store.download(id(1), blob.sha256, request())).toEqual(
      err({ code: "corrupt_content" }),
    );
    const failedDownload = await app.request(`/api/projects/${id(1)}/blobs/${blob.sha256}`);
    expect(failedDownload.status).toBe(500);
    expect(await failedDownload.json()).toEqual({ error: "corrupt_content" });
    expect(await store.upload(id(1), request("original"))).toEqual(
      err({ code: "corrupt_content" }),
    );
    await unlink(path);
    await symlink(join(root, "db.sqlite"), path);
    expect((await store.download(id(1), blob.sha256, request())).ok).toBe(false);
    expect((await store.upload(id(1), request("original"))).ok).toBe(false);
    await unlink(path);
    expect((await store.download(id(1), blob.sha256, request())).ok).toBe(false);
    await rm(join(root, "blobs"), { recursive: true });
    await symlink(root, join(root, "blobs"));
    expect((await store.upload(id(1), request("x"))).ok).toBe(false);
    expect(
      (
        await createBlobStore({
          dataDir: root,
          repository,
          maxSizeBytes: 64,
        })
      ).ok,
    ).toBe(false);
  });

  test("aborted streams, stream failures and close remove their temporary files", async () => {
    const { store, root, repository } = await fixture();
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(writer) {
        writer.enqueue(new TextEncoder().encode("partial"));
      },
    });
    const pending = store.upload(
      id(1),
      new Request("http://localhost", {
        method: "POST",
        headers: request().headers,
        body: stream,
        duplex: "half",
        signal: controller.signal,
      }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(await pending).toEqual(err({ code: "aborted" }));
    const broken = new ReadableStream<Uint8Array>({
      start(writer) {
        writer.error(new Error("secret path"));
      },
    });
    expect(
      await store.upload(
        id(1),
        new Request("http://localhost", {
          method: "POST",
          headers: request().headers,
          body: broken,
          duplex: "half",
        }),
      ),
    ).toEqual(err({ code: "storage_failure" }));
    const blocking = new ReadableStream<Uint8Array>();
    const finishing = store.upload(
      id(1),
      new Request("http://localhost", {
        method: "POST",
        headers: request().headers,
        body: blocking,
        duplex: "half",
      }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await store.close();
    expect(await finishing).toEqual(err({ code: "closed" }));
    await store.close();
    expect(await store.upload(id(1), request())).toEqual(err({ code: "closed" }));
    expect(await store.download(id(1), hash(""), request())).toEqual(err({ code: "closed" }));
    expect(await readdir(join(root, "blobs"))).toEqual([]);
    expect(success(repository.readProject(id(1)))?.state.blobs).toEqual([]);
  });

  test("closed repository fails before publishing; existing metadata survives reopening", async () => {
    const { store, root, repository, database } = await fixture();
    const blob = await upload(store);
    repository.close();
    expect(await store.upload(id(1), request("new"))).toEqual(err({ code: "storage_failure" }));
    const reopened = success(openSqliteRepository(database));
    cleanups.push(async () => {
      reopened.close();
    });
    expect(success(reopened.readBlob(id(1), blob.sha256))).toEqual(blob);
    expect(await readdir(join(root, "blobs"))).toEqual([blob.sha256]);
  });
});
