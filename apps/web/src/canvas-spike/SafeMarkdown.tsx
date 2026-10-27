import Markdown from "react-markdown";

// Deliberately small Markdown subset. No raw HTML, links, image loads or plugins.
const allowedElements = [
  "p",
  "h1",
  "h2",
  "h3",
  "strong",
  "em",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "blockquote",
  "br",
  "hr",
];
export const SafeMarkdown = ({ source }: { source: string }) => (
  <Markdown skipHtml allowedElements={allowedElements} unwrapDisallowed>
    {source}
  </Markdown>
);
