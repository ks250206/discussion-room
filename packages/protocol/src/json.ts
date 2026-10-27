import { err, ok, type Result } from "@discussion-room/domain";

export const PROTOCOL_LIMITS = Object.freeze({
  maxMessageBytes: 1_048_576,
  maxDepth: 64,
  maxNodes: 50_000,
  maxCollectionEntries: 10_000,
  maxEventsPerBatch: 1_000,
  maxResumeBatches: 1_000,
  maxMembers: 1_000,
  maxSelection: 1_000,
  maxDisplayNameLength: 200,
  maxTokenLength: 4_096,
  maxErrorMessageLength: 2_000,
});
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue };
export type BoundaryError = {
  readonly code:
    | "json_unsafe"
    | "message_too_large"
    | "complexity_limit"
    | "invalid_json"
    | "invalid_utf8";
};

/** Byte length of JSON's escaped string, including quotes, without allocating the encoding. */
function stringBytes(value: string): number {
  let size = 2;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 34 || c === 92) size += 2;
    else if (c < 32) size += c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6;
    else if (c < 128) size++;
    else if (c < 2048) size += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        size += 4;
        i++;
      } else size += 6;
    } else size += c >= 0xdc00 && c <= 0xdfff ? 6 : 3;
    if (size > PROTOCOL_LIMITS.maxMessageBytes) return size;
  }
  return size;
}

/** Only standard prototypes survive the snapshot; inspect hooks without invoking accessors. */
function hasPrototypeSerializationHook(): boolean {
  return [Object.prototype, Array.prototype].some((prototype) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "toJSON");
    return (
      descriptor !== undefined &&
      (!Object.hasOwn(descriptor, "value") || typeof descriptor.value === "function")
    );
  });
}

/**
 * Snapshot data properties before schema validation/stringification. Never invokes accessors/toJSON.
 * Reflection on in-process Proxies can execute traps; portable JS cannot identify all Proxies.
 * Network callers should decode text/bytes, whose parsed JSON contains no executable objects.
 */
export function snapshotJson(input: unknown): Result<JsonValue, BoundaryError> {
  let nodes = 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  const fail = (code: BoundaryError["code"]): Result<never, BoundaryError> => err({ code });
  const add = (count: number): boolean => {
    bytes += count;
    return bytes <= PROTOCOL_LIMITS.maxMessageBytes;
  };
  const visit = (value: unknown, depth: number): Result<JsonValue, BoundaryError> => {
    if (++nodes > PROTOCOL_LIMITS.maxNodes || depth > PROTOCOL_LIMITS.maxDepth)
      return fail("complexity_limit");
    if (value === null || typeof value === "boolean")
      return add(value === null ? 4 : value ? 4 : 5) ? ok(value) : fail("message_too_large");
    if (typeof value === "string")
      return add(stringBytes(value)) ? ok(value) : fail("message_too_large");
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Object.is(value, -0)) return fail("json_unsafe");
      return add(String(value).length) ? ok(value) : fail("message_too_large");
    }
    if (typeof value !== "object") return fail("json_unsafe");
    if (ancestors.has(value)) return fail("json_unsafe");
    const array = Array.isArray(value);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (
      array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
    )
      return fail("json_unsafe");
    const keys = Reflect.ownKeys(value);
    if (keys.length > PROTOCOL_LIMITS.maxCollectionEntries + (array ? 1 : 0))
      return fail("complexity_limit");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output: Record<string, JsonValue> = {};
    const items: JsonValue[] = [];
    if (!add(2)) return fail("message_too_large");
    if (array && value.length > PROTOCOL_LIMITS.maxCollectionEntries)
      return fail("complexity_limit");
    if (array && keys.length !== value.length + 1) return fail("json_unsafe");
    ancestors.add(value);
    let index = 0;
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string") return fail("json_unsafe");
      if (array && key !== String(index)) return fail("json_unsafe");
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
        return fail("json_unsafe");
      if (!add((index > 0 ? 1 : 0) + (array ? 0 : stringBytes(key) + 1)))
        return fail("message_too_large");
      const child = visit(descriptor.value, depth + 1);
      if (!child.ok) return child;
      if (array) items.push(child.value);
      else
        Object.defineProperty(output, key, {
          value: child.value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      index++;
    }
    ancestors.delete(value);
    return ok(array ? items : output);
  };
  try {
    const result = visit(input, 0);
    return hasPrototypeSerializationHook() ? fail("json_unsafe") : result;
  } catch {
    return fail("json_unsafe");
  }
}

/** Check raw depth/node budget before JSON.parse can construct an oversized object graph. */
function withinRawBudget(text: string): boolean {
  let depth = 0;
  let nodes = 0;
  let quoted = false;
  let escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
      nodes++;
    } else if (char === "{" || char === "[") {
      if (++depth > PROTOCOL_LIMITS.maxDepth + 1) return false;
      nodes++;
    } else if (char === "}" || char === "]") depth--;
    else if (char === ",") nodes++;
    // For N value nodes: keys <= N-1, strings+containers <= N, commas <= N-1.
    // A 3N budget bounds parsing work without rejecting any encoder-accepted JSON tree.
    if (nodes > PROTOCOL_LIMITS.maxNodes * 3) return false;
  }
  return true;
}

export function parseJson(input: string | Uint8Array): Result<JsonValue, BoundaryError> {
  if (input.length > PROTOCOL_LIMITS.maxMessageBytes) return err({ code: "message_too_large" });
  let text: string;
  if (typeof input === "string") text = input;
  else {
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
    } catch {
      return err({ code: "invalid_utf8" });
    }
  }
  if (new TextEncoder().encode(text).byteLength > PROTOCOL_LIMITS.maxMessageBytes)
    return err({ code: "message_too_large" });
  if (!withinRawBudget(text)) return err({ code: "complexity_limit" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err({ code: "invalid_json" });
  }
  return snapshotJson(parsed);
}
