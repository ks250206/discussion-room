import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  defaultSource,
  parseLock,
  resolvePackages,
  sha256Hex,
  verifyWheel,
  versionDirectory,
  type PyodideLock,
} from "./vendor.ts";

const entry = (name: string, depends: string[] = []) => ({
  name,
  version: "1.0.0",
  file_name: `${name}-1.0.0-py3-none-any.whl`,
  sha256: sha256Hex(new TextEncoder().encode(name)),
  depends,
});
const lock: PyodideLock = {
  info: { python: "3.14.2", abi_version: "2026_0", arch: "wasm32" },
  packages: {
    numpy: entry("numpy"),
    six: entry("six"),
    "python-dateutil": entry("python-dateutil", ["six"]),
    pandas: entry("pandas", ["numpy", "python-dateutil"]),
    scipy: entry("scipy", ["numpy"]),
    requests: entry("requests"),
  },
};

test("resolves the dependency closure of allowlisted packages once, in name order", () => {
  const resolved = resolvePackages(lock, ["pandas", "scipy", "numpy"]);
  expect(resolved.ok && resolved.value.map((item) => item.name)).toEqual([
    "numpy",
    "pandas",
    "python-dateutil",
    "scipy",
    "six",
  ]);
});

test("rejects packages outside the allowlist even when the lock has them", () => {
  expect(resolvePackages(lock, ["numpy", "requests"])).toEqual({
    ok: false,
    error: "Not in the package allowlist (numpy, scipy, pandas, matplotlib): requests",
  });
});

test("reports a dependency missing from the lock instead of skipping it", () => {
  const broken: PyodideLock = { ...lock, packages: { numpy: entry("numpy", ["libopenblas"]) } };
  expect(resolvePackages(broken, ["numpy"])).toEqual({
    ok: false,
    error: "Package missing from lock: libopenblas",
  });
});

test("only bytes matching the lock sha256 are accepted", () => {
  const numpy = entry("numpy");
  const good = new TextEncoder().encode("numpy");
  expect(verifyWheel(numpy, good)).toEqual({ ok: true, value: good });
  const bad = verifyWheel(numpy, new TextEncoder().encode("numpy tampered"));
  expect(bad.ok).toBe(false);
  expect(!bad.ok && bad.error).toContain(`expected ${numpy.sha256}`);
});

test("lock validation refuses file names that could escape the version directory", () => {
  for (const file_name of ["../evil.whl", "sub/numpy.whl", ".hidden.whl", "numpy.tar.gz"]) {
    const parsed = parseLock({ ...lock, packages: { numpy: { ...entry("numpy"), file_name } } });
    expect(parsed.ok).toBe(false);
  }
  expect(parseLock({ ...lock, packages: { numpy: { ...entry("numpy"), sha256: "abc" } } }).ok).toBe(
    false,
  );
});

test("only stable versions get an immutable version directory", () => {
  expect(versionDirectory("314.0.7")).toEqual({ ok: true, value: "v314.0.7" });
  expect(versionDirectory("315.0.0-alpha.2").ok).toBe(false);
  expect(versionDirectory("latest").ok).toBe(false);
  expect(defaultSource("314.0.7")).toBe("https://cdn.jsdelivr.net/pyodide/v314.0.7/full/");
});

test("the pinned npm lock parses and resolves the MVP packages", () => {
  const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  const root = dirname(require.resolve("pyodide/package.json"));
  const parsed = parseLock(JSON.parse(readFileSync(join(root, "pyodide-lock.json"), "utf8")));
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.value.info).toMatchObject({ python: "3.14.2", abi_version: "2026_0" });
  const resolved = resolvePackages(parsed.value, ["numpy", "scipy", "pandas", "matplotlib"]);
  if (!resolved.ok) throw new Error(resolved.error);
  expect(resolved.value.find((item) => item.name === "numpy")?.version).toBe("2.4.6");
  expect(resolved.value).toHaveLength(14);
});
