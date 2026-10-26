import { isProxy } from "node:util/types";
import * as v from "valibot";

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue };

/** Inspect descriptors before schemas/stringify can invoke a getter or toJSON. */
export function isLosslessJson(input: unknown): input is JsonValue {
  try {
    return inspectJson(input, new Set<object>());
  } catch {
    return false;
  }
}

function inspectJson(input: unknown, active: Set<object>): input is JsonValue {
  if (active.size > 256) return false;
  if (input === null || typeof input === "string" || typeof input === "boolean") return true;
  if (typeof input === "number") return Number.isFinite(input) && !Object.is(input, -0);
  if (typeof input !== "object" || active.has(input) || isProxy(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  const array = Array.isArray(input);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
    return false;
  active.add(input);
  try {
    const keys = Reflect.ownKeys(input);
    if (array && keys.length !== input.length + 1) return false;
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string") return false;
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) return false;
      const value: unknown = descriptor.value;
      if (!inspectJson(value, active)) return false;
    }
    return true;
  } finally {
    active.delete(input);
  }
}

export const JsonValueSchema = v.custom<JsonValue>(isLosslessJson, "Expected lossless JSON");
export const JsonObjectSchema = v.custom<JsonObject>(
  (input) =>
    isLosslessJson(input) && typeof input === "object" && input !== null && !Array.isArray(input),
  "Expected a lossless JSON object",
);

/** Property order is not content; compare only after the lossless JSON gate. */
export function equalJson(left: unknown, right: unknown): boolean {
  if (!isLosslessJson(left) || !isLosslessJson(right)) return false;
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => {
    const a: unknown = Reflect.get(left, key);
    const b: unknown = Reflect.get(right, key);
    return Object.hasOwn(right, key) && isLosslessJson(a) && isLosslessJson(b) && equalJson(a, b);
  });
}
