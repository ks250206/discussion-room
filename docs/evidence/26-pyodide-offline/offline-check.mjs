// Issue #26: 外部ネットワークを遮断した Chromium で、ローカルサーバー配信の Pyodide を検証する。
// 前提: pnpm pyodide:fetch --packages numpy,scipy,pandas,matplotlib
//       pnpm --filter @discussion-room/web spike:pyodide:build
// 実行: node docs/evidence/26-pyodide-offline/offline-check.mjs [screenshot-dir]
// Playwright はリポジトリの依存ではない（E12 で導入）。PLAYWRIGHT_MODULE で解決先を指定できる。
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAppServer } from "../../../apps/server/src/app.ts";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const webRoot = fileURLToPath(new URL("../../../apps/web/dist-pyodide-spike/", import.meta.url));
const shots = process.argv[2];
const version = "314.0.7";

// サーバー側で実際に配信したパスとバイト数を数える（ブラウザーキャッシュの効果を見るため）。
const served = [];
const server = createAppServer({ webRoot, pyodideRoot: `${webRoot}pyodide` });
server.prependListener("request", (request, response) => {
  response.on("finish", () => {
    served.push({ path: request.url, status: response.statusCode, bytes: Number(response.getHeader("content-length") ?? 0) });
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const pyodideServed = () => served.filter((item) => item.path.startsWith("/pyodide/"));
const summarize = (items) => ({ requests: items.length, bytes: items.reduce((sum, item) => sum + item.bytes, 0) });

// 到達できないプロキシを指定し、loopback 以外の通信をネットワーク層で失敗させる。
// route は HTTP キャッシュを無効にするため使わず、Worker を含む全要求を記録する。
// 非永続 context のメモリキャッシュは大きなエントリを保持しないため、毎回新しい
// プロファイルの永続 context（ディスクキャッシュ）を使う。
const args = ["--proxy-server=http://127.0.0.1:9"];
const external = [];
const newContext = async () => {
  const profile = await mkdtemp(join(tmpdir(), "pyodide-offline-"));
  const context = await chromium.launchPersistentContext(profile, {
    args,
    viewport: { width: 1280, height: 900 },
  });
  context.on("request", (request) => {
    if (new URL(request.url()).hostname !== "127.0.0.1") external.push(request.url());
  });
  context.on("close", () => void rm(profile, { recursive: true, force: true }));
  return context;
};
const report = { base, userAgent: "", spike: {}, packages: [], external };

// 1. 外部へ出られないことの確認
{
  const context = await newContext();
  const page = await context.newPage();
  await page.goto(`${base}/pyodide-spike.html`);
  report.userAgent = await page.evaluate(() => navigator.userAgent);
  report.externalProbe = await page.evaluate(async (url) => {
    try {
      await fetch(url, { mode: "no-cors" });
      return "reachable";
    } catch (error) {
      return `blocked: ${error.message}`;
    }
  }, `https://cdn.jsdelivr.net/pyodide/v${version}/full/pyodide-lock.json`);
  await context.close();
}

// 2. spike UI: 明示ロード → NumPy → Stop → 再ロード（HTTP キャッシュ）→ NumPy
{
  const context = await newContext();
  const page = await context.newPage();
  served.length = 0;
  await page.goto(`${base}/pyodide-spike.html`);
  await page.waitForTimeout(500);
  report.spike.pyodideRequestsBeforeClick = pyodideServed().length;
  const load = page.getByRole("button", { name: "ローカル配信から環境をロード / 再起動" });
  const status = page.locator("output strong");
  const result = page.getByLabel("計算結果");
  const runNumpy = async () => {
    await page.getByRole("button", { name: "NumPy を実行" }).click();
    await page.waitForFunction(() => document.querySelector("pre")?.textContent?.startsWith("{"));
    return JSON.parse(await result.textContent());
  };
  const metrics = async () => (await page.locator("dd").allTextContents()).slice(0, 3);
  await load.click();
  await status.filter({ hasText: /^ready$/ }).waitFor({ timeout: 120_000 });
  report.spike.first = { result: await runNumpy(), metrics: await metrics(), served: summarize(pyodideServed()) };
  if (shots) await page.screenshot({ path: `${shots}/numpy-offline-first.png`, fullPage: true });

  served.length = 0;
  await page.getByRole("button", { name: "無限ループを開始" }).click();
  await page.getByRole("button", { name: "Stop（Worker 終了）" }).click();
  await status.filter({ hasText: /^stopped$/ }).waitFor();
  await load.click();
  await status.filter({ hasText: /^ready$/ }).waitFor({ timeout: 120_000 });
  report.spike.afterStop = {
    result: await runNumpy(),
    metrics: await metrics(),
    served: summarize(pyodideServed()),
    servedPaths: pyodideServed().map((item) => item.path),
  };
  if (shots) await page.screenshot({ path: `${shots}/numpy-offline-restarted.png`, fullPage: true });
  await context.close();
}

// 3. パッケージごとのロード時間（新しい context = HTTP キャッシュなし、続けて同じ context で再ロード）
for (const name of ["numpy", "scipy", "pandas", "matplotlib"]) {
  const context = await newContext();
  const measure = async () => {
    const page = await context.newPage();
    await page.goto(`${base}/pyodide-spike.html`);
    served.length = 0;
    const timing = await page.evaluate(
      async ({ name, indexURL }) => {
        const t0 = performance.now();
        const { loadPyodide } = await import(`${indexURL}pyodide.mjs`);
        const pyodide = await loadPyodide({ indexURL });
        const t1 = performance.now();
        await pyodide.loadPackage(name, { messageCallback: () => {} });
        const t2 = performance.now();
        const imported = pyodide.runPython(`import ${name}; ${name}.__version__`);
        const t3 = performance.now();
        return { runtimeMs: t1 - t0, loadPackageMs: t2 - t1, importMs: t3 - t2, imported };
      },
      { name, indexURL: `${base}/pyodide/v${version}/` },
    );
    await page.close();
    return { ...timing, served: summarize(pyodideServed()) };
  };
  report.packages.push({ name, cold: await measure(), warm: await measure() });
  await context.close();
}

// 4. サーバー停止時: ロードは明示エラーになり、外部 CDN へ迂回しない
{
  const context = await newContext();
  const page = await context.newPage();
  await page.goto(`${base}/pyodide-spike.html`);
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeAllConnections();
  await closed;
  await page.getByRole("button", { name: "ローカル配信から環境をロード / 再起動" }).click();
  await page.locator("output strong").filter({ hasText: /^error$/ }).waitFor({ timeout: 60_000 });
  report.serverDown = await page.getByRole("alert").textContent();
  if (shots) await page.screenshot({ path: `${shots}/server-down-error.png`, fullPage: true });
  await context.close();
}

console.log(JSON.stringify(report, null, 2));
