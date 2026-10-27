import { loadPyodide } from "pyodide";
import * as v from "valibot";
import { validateOutput, pyodideVersion, runtimeIndexUrl } from "./protocol.ts";
import type { Demo } from "./protocol.ts";

const heapSchema = v.object({ _module: v.object({ HEAPU8: v.instance(Uint8Array) }) });
const programs: Record<Demo, string> = {
  numpy: `import json, sys, numpy as np
a = np.arange(1, 10001, dtype=np.float64)
json.dumps({"sum": float(a.sum()), "mean": float(a.mean()), "count": int(a.size), "numpy": np.__version__, "python": sys.version.split()[0]})`,
  infinite: "while True:\n    pass",
  exception: 'raise ValueError("Synthetic spike exception")',
};

// Only imported by the module Worker. stdout/stderr are deliberately discarded:
// this spike offers fixed programs and one bounded structured result, not a log stream.
export async function loadEngine() {
  const runtime = await loadPyodide({
    indexURL: runtimeIndexUrl,
    stdout: () => {},
    stderr: () => {},
  });
  if (runtime.version !== pyodideVersion) throw new Error("Pyodide version mismatch");
  await runtime.loadPackage("numpy", { messageCallback: () => {}, errorCallback: () => {} });
  function heapBytes(): number | null {
    const parsed = v.safeParse(heapSchema, runtime);
    // Internal Emscripten heap view is optional and schema-checked for this pinned runtime.
    // oxlint-disable-next-line no-underscore-dangle
    return parsed.success ? parsed.output._module.HEAPU8.buffer.byteLength : null;
  }
  return {
    heapBytes,
    async run(demo: Demo) {
      const start = performance.now();
      const result: unknown = await runtime.runPythonAsync(programs[demo]);
      // The selected demos return only a JSON string or raise/loop; no PyProxy crosses threads.
      if (typeof result !== "string") throw new Error("Unexpected synthetic program result");
      const checked = validateOutput(result);
      if (!checked.ok) throw new Error(checked.error);
      return {
        output: checked.value,
        computeMs: performance.now() - start,
        heapBytes: heapBytes(),
      };
    },
  };
}
