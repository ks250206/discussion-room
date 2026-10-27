// 固定版 Pyodide のランタイムと許可パッケージを apps/web/public/pyodide/v<版>/ に配置する。
// 使い方: pnpm pyodide:fetch [--packages numpy,scipy] [--source <https URL | ディレクトリ>]
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as v from "valibot";
import {
  coreFiles,
  defaultSource,
  parseLock,
  resolvePackages,
  sha256Hex,
  verifyWheel,
  versionDirectory,
  type LockPackage,
  type Result,
} from "./vendor.ts";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const fail = (message: string): never => {
  console.error(message);
  return process.exit(1);
};
const unwrap = <T>(result: Result<T>): T => (result.ok ? result.value : fail(result.error));

const { values } = parseArgs({
  options: {
    packages: { type: "string", default: "numpy" },
    source: { type: "string" },
    out: { type: "string", default: join(repoRoot, "apps/web/public/pyodide") },
  },
});

// pnpm の厳格な解決に合わせ、依存を宣言している apps/web から npm パッケージを解決する。
const require = createRequire(join(repoRoot, "apps/web/package.json"));
const npmRoot = dirname(require.resolve("pyodide/package.json"));
const npmPackage = v.parse(
  v.object({ version: v.string() }),
  JSON.parse(await readFile(join(npmRoot, "package.json"), "utf8")),
);
const version = npmPackage.version;
const outDir = join(values.out, unwrap(versionDirectory(version)));
const lock = unwrap(
  parseLock(JSON.parse(await readFile(join(npmRoot, "pyodide-lock.json"), "utf8"))),
);
const requested = values.packages
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name !== "");
const wheels = unwrap(resolvePackages(lock, requested));
const source = values.source ?? defaultSource(version);
if (/^[a-z]+:/i.test(source) && !source.startsWith("https://"))
  fail(`--source must be an https URL or a local directory: ${source}`);

const existingHash = async (path: string): Promise<string | undefined> => {
  try {
    return sha256Hex(await readFile(path));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
};

const download = async (entry: LockPackage): Promise<Uint8Array> => {
  try {
    if (!source.startsWith("https://")) return await readFile(join(source, entry.file_name));
    const response = await fetch(new URL(entry.file_name, source));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return fail(
      `Cannot read ${entry.file_name} from ${source}: ${reason}. ` +
        "Use --source with an extracted official release directory if the CDN is unreachable.",
    );
  }
};

await mkdir(outDir, { recursive: true });
console.log(
  `Pyodide ${version} (Python ${lock.info.python}, ABI ${lock.info.abi_version}) -> ${outDir}`,
);
let total = 0;
for (const file of coreFiles) {
  const target = join(outDir, file);
  await copyFile(join(npmRoot, file), target);
  const { size } = await stat(target);
  total += size;
  console.log(`  core     ${file} ${size} bytes (npm package)`);
}
for (const entry of wheels) {
  const target = join(outDir, entry.file_name);
  let status = "cached";
  if ((await existingHash(target)) !== entry.sha256) {
    const bytes = unwrap(verifyWheel(entry, await download(entry)));
    // 検証済みのバイト列だけを一時ファイル経由で置き換える。
    const partial = `${target}.partial`;
    await writeFile(partial, bytes);
    await rename(partial, target);
    status = "fetched";
  }
  const { size } = await stat(target);
  total += size;
  console.log(`  ${status.padEnd(8)} ${entry.file_name} ${size} bytes sha256 ok`);
}
console.log(`Total ${total} bytes for ${wheels.map((entry) => entry.name).join(", ")}`);
