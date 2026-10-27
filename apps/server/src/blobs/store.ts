import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import * as v from "valibot";
import {
  createId,
  err,
  IdSchema,
  ok,
  validate,
  type Id,
  type Result,
} from "@discussion-room/domain";
import {
  BlobFilenameSchema,
  BlobMimeSchema,
  Sha256Schema,
  type Repository,
  type StoredBlob,
  type BlobRegistration,
} from "../repository/index.ts";

export type BlobError = {
  readonly code:
    | "forbidden"
    | "invalid_metadata"
    | "unsupported_mime"
    | "too_large"
    | "not_found"
    | "storage_failure"
    | "corrupt_content"
    | "aborted"
    | "closed";
};
const contentMemoryLimit = 64 * 1024 * 1024;
const failure = (code: BlobError["code"]): Result<never, BlobError> => err({ code });
export type BlobAuthorizer = (input: {
  readonly operation: "read" | "write";
  readonly projectId: Id;
  readonly request: Request;
}) => boolean | Promise<boolean>;
export type BlobStore = {
  upload(projectId: unknown, request: Request): Promise<Result<BlobRegistration, BlobError>>;
  download(
    projectId: unknown,
    sha256: unknown,
    request: Request,
  ): Promise<
    Result<
      {
        readonly metadata: StoredBlob;
        readonly bytes: Uint8Array<ArrayBuffer>;
      },
      BlobError
    >
  >;
  /** Cancels pending readers, waits for cleanup; repository lifetime belongs to caller. */
  close(): Promise<void>;
};

/** Explicit trusted DATA_DIR only; never constructed by normal server startup. */
export async function createBlobStore(options: {
  dataDir: string;
  repository: Repository;
  maxSizeBytes: number;
  authorize?: BlobAuthorizer;
}): Promise<Result<BlobStore, BlobError>> {
  // Downloads are integrity checked before success, with a strict finite memory bound.
  if (
    !v.is(
      v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(contentMemoryLimit)),
      options.maxSizeBytes,
    )
  )
    return failure("invalid_metadata");
  if (!isAbsolute(options.dataDir) || options.dataDir.trim().length === 0)
    return failure("invalid_metadata");
  const maximum = options.maxSizeBytes;
  const authorize = options.authorize ?? (() => false);
  const repository = options.repository;
  let root: string;
  let directory: string;
  let checkDirectory: () => Promise<boolean>;
  try {
    const inputRoot = resolve(options.dataDir);
    await mkdir(inputRoot, { recursive: true, mode: 0o700 });
    const inputInfo = await lstat(inputRoot);
    if (!inputInfo.isDirectory() || inputInfo.isSymbolicLink()) return failure("storage_failure");
    root = await realpath(inputRoot);
    directory = join(root, "blobs");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(root);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) return failure("storage_failure");
    checkDirectory = async () => {
      const [currentRoot, current] = await Promise.all([lstat(root), lstat(directory)]);
      return (
        currentRoot.isDirectory() &&
        !currentRoot.isSymbolicLink() &&
        currentRoot.ino === rootInfo.ino &&
        currentRoot.dev === rootInfo.dev &&
        current.isDirectory() &&
        !current.isSymbolicLink() &&
        current.ino === info.ino &&
        current.dev === info.dev
      );
    };
  } catch {
    return failure("storage_failure");
  }
  let closed = false;
  const closing = new AbortController();
  const active = new Set<Promise<unknown>>();
  const track = <T>(operation: Promise<T>): Promise<T> => {
    active.add(operation);
    void operation.then(
      () => active.delete(operation),
      () => active.delete(operation),
    );
    return operation;
  };
  const allowed = async (operation: "read" | "write", projectId: Id, request: Request) => {
    try {
      return await authorize({ operation, projectId, request });
    } catch {
      return false;
    }
  };
  const readBytes = async (
    hash: string,
    size: number,
  ): Promise<Result<Uint8Array<ArrayBuffer>, BlobError>> => {
    if (size > contentMemoryLimit) return failure("too_large");
    if (!(await checkDirectory())) return failure("storage_failure");
    const file = await open(
      join(directory, hash),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size !== size) return failure("corrupt_content");
      // Read exactly the declared bound; do not use readFile on a concurrently growing file.
      const bytes = new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        const result = await file.read(bytes, offset, size - offset, offset);
        if (result.bytesRead === 0) return failure("corrupt_content");
        offset += result.bytesRead;
      }
      if (
        (await file.stat()).size !== size ||
        createHash("sha256").update(bytes).digest("hex") !== hash
      )
        return failure("corrupt_content");
      return ok(bytes);
    } finally {
      await file.close();
    }
  };
  const upload = async (
    inputProject: unknown,
    request: Request,
  ): Promise<Result<BlobRegistration, BlobError>> => {
    if (closed) return failure("closed");
    const project = validate(IdSchema, inputProject);
    if (!project.ok) return failure("invalid_metadata");
    if (!(await allowed("write", project.value, request))) return failure("forbidden");
    if (closed) return failure("closed");
    const existingProject = repository.readProject(project.value);
    if (!existingProject.ok) return failure("storage_failure");
    if (!existingProject.value) return failure("not_found");
    let filename: string;
    try {
      filename = decodeURIComponent(request.headers.get("x-blob-filename") ?? "");
    } catch {
      return failure("invalid_metadata");
    }
    const name = validate(BlobFilenameSchema, filename);
    if (!name.ok) return failure("invalid_metadata");
    const mime = validate(BlobMimeSchema, request.headers.get("content-type"));
    if (!mime.ok) return failure("unsupported_mime");
    const length = request.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
      return failure("invalid_metadata");
    if (length !== null && Number(length) > maximum) return failure("too_large");
    if (request.signal.aborted) return failure("aborted");
    const temporary = join(directory, `.upload-${randomUUID()}`);
    let file;
    let ownsTemporary = false;
    const reader = request.body?.getReader();
    const cancel = () => {
      void reader?.cancel().catch(() => undefined);
    };
    request.signal.addEventListener("abort", cancel, { once: true });
    closing.signal.addEventListener("abort", cancel, { once: true });
    try {
      if (!(await checkDirectory())) return failure("storage_failure");
      file = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      ownsTemporary = true;
      const hash = createHash("sha256");
      const decoder =
        mime.value.startsWith("text/") ||
        ["chemical/x-cif", "application/json"].includes(mime.value)
          ? new TextDecoder("utf-8", { fatal: true })
          : undefined;
      let size = 0;
      let prefix = Buffer.alloc(0);
      if (reader) {
        while (true) {
          const chunk = await reader.read();
          if (closed) return failure("closed");
          if (request.signal.aborted) return failure("aborted");
          if (chunk.done) break;
          const raw: unknown = chunk.value;
          const data = validate(v.instance(Uint8Array), raw);
          if (!data.ok) return failure("invalid_metadata");
          size += data.value.byteLength;
          if (size > maximum) return failure("too_large");
          try {
            if (decoder?.decode(data.value, { stream: true }).includes("\u0000"))
              return failure("unsupported_mime");
          } catch {
            return failure("unsupported_mime");
          }
          if (prefix.length < 8)
            prefix = Buffer.concat([
              prefix,
              Buffer.from(data.value.subarray(0, 8 - prefix.length)),
            ]);
          hash.update(data.value);
          let offset = 0;
          while (offset < data.value.length) {
            const written = await file.write(data.value, offset, data.value.length - offset);
            if (written.bytesWritten === 0) return failure("storage_failure");
            offset += written.bytesWritten;
          }
        }
      }
      if (closed) return failure("closed");
      if (request.signal.aborted) return failure("aborted");
      if (length !== null && Number(length) !== size) return failure("invalid_metadata");
      try {
        decoder?.decode();
      } catch {
        return failure("unsupported_mime");
      }
      if (
        (mime.value === "image/png" &&
          !prefix.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (mime.value === "image/jpeg" && !prefix.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
      )
        return failure("unsupported_mime");
      await file.sync();
      await file.close();
      file = undefined;
      const sha256 = hash.digest("hex");
      if (!(await checkDirectory())) return failure("storage_failure");
      // link is atomic and cannot replace any existing path. Never rename over content.
      try {
        await link(temporary, join(directory, sha256));
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      }
      const verified = await readBytes(sha256, size);
      if (!verified.ok) return verified;
      if (closed) return failure("closed");
      if (request.signal.aborted) return failure("aborted");
      const id = createId();
      if (!id.ok) return failure("storage_failure");
      const stored = repository.registerBlob({
        id: id.value,
        projectId: project.value,
        schemaVersion: 1,
        storage: "content-addressed",
        validation: "bytes-verified",
        sha256,
        filename: name.value,
        mime: mime.value,
        size,
      });
      return stored.ok ? stored : failure("storage_failure");
    } catch {
      return failure(request.signal.aborted ? "aborted" : closed ? "closed" : "storage_failure");
    } finally {
      request.signal.removeEventListener("abort", cancel);
      closing.signal.removeEventListener("abort", cancel);
      try {
        await reader?.cancel();
      } catch {
        /* Already errored/aborted. */
      }
      reader?.releaseLock();
      // Cleanup is best effort: a failed unlink can leave a private temporary,
      // but must never replace an already committed success (or the original error).
      await file?.close().catch(() => undefined);
      // Only a temporary name opened by this upload is ours to remove.
      // Published hashes may be shared/orphaned and are never removed here.
      if (ownsTemporary) await unlink(temporary).catch(() => undefined);
    }
  };
  const download = async (
    inputProject: unknown,
    inputHash: unknown,
    request: Request,
  ): ReturnType<BlobStore["download"]> => {
    if (closed) return failure("closed");
    const project = validate(IdSchema, inputProject);
    const hash = validate(Sha256Schema, inputHash);
    if (!project.ok || !hash.ok) return failure("invalid_metadata");
    if (!(await allowed("read", project.value, request))) return failure("forbidden");
    if (closed) return failure("closed");
    const stored = repository.readBlob(project.value, hash.value);
    if (!stored.ok) return failure("storage_failure");
    if (!stored.value) return failure("not_found");
    try {
      const bytes = await readBytes(hash.value, stored.value.size);
      return bytes.ok ? ok({ metadata: stored.value, bytes: bytes.value }) : bytes;
    } catch {
      return failure("storage_failure");
    }
  };
  return ok({
    upload: (project, request) =>
      track(upload(project, request).catch(() => failure("storage_failure"))),
    download: (project, hash, request) => track(download(project, hash, request)),
    async close() {
      closed = true;
      closing.abort();
      await Promise.allSettled(active);
    },
  });
}
