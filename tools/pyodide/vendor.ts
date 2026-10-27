import { createHash } from "node:crypto";
import * as v from "valibot";

/** concept.md §5.1 の MVP パッケージ。これ以外は互換性確認後に追加する。 */
export const allowedPackages = ["numpy", "scipy", "pandas", "matplotlib"] as const;

/**
 * Pyodide の indexURL に必要なランタイム一式。loader（pyodide.mjs）は Worker に
 * バンドルされるが、配信物単体で起動を確認できるよう同じ版を置く。
 */
export const coreFiles = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
] as const;

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

// lock は npm パッケージ（pnpm-lock の integrity で固定）由来だが、パス要素として
// 使うファイル名は検証する。
const fileName = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_][A-Za-z0-9_.+-]*\.(?:whl|zip)$/));
const sha256 = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));
const lockSchema = v.object({
  info: v.object({ python: v.string(), abi_version: v.string(), arch: v.string() }),
  packages: v.record(
    v.string(),
    v.object({
      name: v.string(),
      version: v.string(),
      file_name: fileName,
      sha256,
      depends: v.array(v.string()),
    }),
  ),
});
export type PyodideLock = v.InferOutput<typeof lockSchema>;
export type LockPackage = PyodideLock["packages"][string];

export function parseLock(input: unknown): Result<PyodideLock> {
  const parsed = v.safeParse(lockSchema, input);
  return parsed.success
    ? { ok: true, value: parsed.output }
    : { ok: false, error: `pyodide-lock.json: ${v.summarize(parsed.issues)}` };
}

/** 要求パッケージを許可リストで検査し、lock の depends を辿った閉包を名前順で返す。 */
export function resolvePackages(
  lock: PyodideLock,
  requested: readonly string[],
): Result<LockPackage[]> {
  const allowed: readonly string[] = allowedPackages;
  const rejected = requested.filter((name) => !allowed.includes(name));
  if (rejected.length > 0)
    return {
      ok: false,
      error: `Not in the package allowlist (${allowed.join(", ")}): ${rejected.join(", ")}`,
    };
  const seen = new Map<string, LockPackage>();
  const pending = [...requested];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (seen.has(name)) continue;
    const entry = lock.packages[name];
    if (entry === undefined) return { ok: false, error: `Package missing from lock: ${name}` };
    seen.set(name, entry);
    pending.push(...entry.depends);
  }
  return {
    ok: true,
    value: [...seen.values()].toSorted((a, b) => a.name.localeCompare(b.name)),
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 取得したバイト列が lock の sha256 と一致する場合だけ配置してよい。 */
export function verifyWheel(entry: LockPackage, bytes: Uint8Array): Result<Uint8Array> {
  const actual = sha256Hex(bytes);
  return actual === entry.sha256
    ? { ok: true, value: bytes }
    : {
        ok: false,
        error: `sha256 mismatch for ${entry.file_name}: expected ${entry.sha256}, got ${actual}`,
      };
}

/** 版ごとのディレクトリ。サーバーはこの接頭辞の下を immutable としてキャッシュさせる。 */
export function versionDirectory(version: string): Result<string> {
  return /^\d+\.\d+\.\d+$/.test(version)
    ? { ok: true, value: `v${version}` }
    : { ok: false, error: `Only stable x.y.z Pyodide versions are vendored: ${version}` };
}

export function defaultSource(version: string): string {
  return `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;
}
