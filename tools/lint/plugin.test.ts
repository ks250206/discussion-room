import { RuleTester } from "vite-plus/lint/plugins-dev";
import { describe, it } from "vite-plus/test";
import { noClass } from "./plugin.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-class", noClass, {
  valid: [
    "type Point = { x: number; y: number };",
    "interface Shape { area(): number }",
    "export const move = (p: { x: number }, dx: number) => ({ x: p.x + dx });",
  ],
  invalid: [
    { code: "class Foo {}", errors: [{ messageId: "noClass" }] },
    { code: "export class Foo { bar = 1 }", errors: [{ messageId: "noClass" }] },
    { code: "export default class {}", errors: [{ messageId: "noClass" }] },
    { code: "const Foo = class {};", errors: [{ messageId: "noClass" }] },
  ],
});
