import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { SafeMarkdown } from "./SafeMarkdown.tsx";

describe("spike Markdown boundary", () => {
  it("renders the documented lightweight Markdown subset", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown source={"## Synthetic\n\n**Bold** and `code`\n\n- one\n- two"} />,
    );
    expect(html).toContain("<h2>Synthetic</h2>");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>two</li>");
  });
  it("never mounts raw HTML, links, executable URLs or remote images", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown
        source={
          '<script>alert(1)</script>\n\n<img src="https://example.invalid/pixel" onerror="alert(2)">\n\n![remote](https://example.invalid/image)\n\n[click](javascript:alert%281%29)\n\n[safe](https://example.invalid)'
        }
      />,
    );
    expect(html).not.toMatch(/<(script|img|a)\b/);
    expect(html).not.toContain("src=");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("onerror");
    expect(html).toContain("safe");
  });
});
