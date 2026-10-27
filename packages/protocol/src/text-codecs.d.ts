/**
 * Minimal standard text codec surface for this package's standalone ES2023 tsconfig only.
 * Do not include this ambient file in consumers that already load DOM or Node codec globals.
 * No runtime implementation, DOM library or Node global library is provided here.
 */
declare const TextEncoder: {
  new (): {
    encode(input: string): Uint8Array;
  };
};
declare const TextDecoder: {
  new (
    label: "utf-8",
    options: { readonly fatal: boolean; readonly ignoreBOM: boolean },
  ): {
    decode(input: Uint8Array): string;
  };
};
