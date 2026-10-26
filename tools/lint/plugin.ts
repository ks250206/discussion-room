import { definePlugin, defineRule } from "vite-plus/lint/plugins";

export const noClass = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow classes. Domain logic is expressed with types and pure functions (concept.md §8.5).",
    },
    messages: {
      noClass:
        "Classes are not allowed here. Use type/interface definitions and pure functions instead.",
    },
    schema: [],
  },
  create(context) {
    return {
      ClassDeclaration(node) {
        context.report({ node, messageId: "noClass" });
      },
      ClassExpression(node) {
        context.report({ node, messageId: "noClass" });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "discussion-room" },
  rules: {
    "no-class": noClass,
  },
});
