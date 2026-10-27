import * as v from "valibot";
import { IdSchema } from "@discussion-room/domain";

export const Sha256Schema = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/));
export const BlobFilenameSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(240),
  v.check(
    (name) =>
      !/[/\\:]/u.test(name) &&
      !Array.from(name).some((character) => {
        const code = character.codePointAt(0);
        return code !== undefined && (code < 32 || (code >= 127 && code <= 159));
      }) &&
      !name.startsWith(".") &&
      name.trim() === name &&
      !/[\uD800-\uDFFF\p{Cf}]/u.test(name),
  ),
);
export const BlobMimeSchema = v.picklist([
  "application/octet-stream",
  "text/plain",
  "text/csv",
  "chemical/x-cif",
  "application/json",
  "image/png",
  "image/jpeg",
]);
/** Byte integrity only; text/scientific content and data-use permission remain unverified. */
export const StoredBlobSchema = v.pipe(
  v.strictObject({
    id: IdSchema,
    projectId: IdSchema,
    schemaVersion: v.literal(1),
    storage: v.literal("content-addressed"),
    validation: v.literal("bytes-verified"),
    sha256: Sha256Schema,
    filename: BlobFilenameSchema,
    mime: BlobMimeSchema,
    size: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  }),
  v.readonly(),
);
export type StoredBlob = v.InferOutput<typeof StoredBlobSchema>;

export type BlobRegistration = { readonly metadata: StoredBlob; readonly deduplicated: boolean };
