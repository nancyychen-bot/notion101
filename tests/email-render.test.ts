import { describe, it, expect } from "vitest";
import { renderTemplate, substitute } from "../lib/email/render";

describe("substitute", () => {
  it("replaces known tokens and leaves unknown ones", () => {
    expect(substitute("Hi {{firstName}} {{x}}", { firstName: "Ada" })).toBe("Hi Ada {{x}}");
  });
});

describe("renderTemplate", () => {
  it("renders bold, italic, links, and paragraphs; strips markup in text", () => {
    const r = renderTemplate(
      { subject: "Hello {{name}}", body: "Hi **there**,\nline two\n\n[Click]({{url}})" },
      { name: "Ada", url: "https://x.co" },
    );
    expect(r.subject).toBe("Hello Ada");
    expect(r.html).toContain("<strong>there</strong>");
    expect(r.html).toContain('<a href="https://x.co"');
    expect(r.html).toContain("<br/>"); // "Hi there," and "line two" share a paragraph
    expect(r.html.match(/<p /g)?.length).toBe(2); // blank line splits paragraphs
    expect(r.text).toContain("Click: https://x.co");
    expect(r.text).not.toContain("**");
  });

  it("cleans up empty parens/dangling dashes in subjects", () => {
    expect(renderTemplate({ subject: "Event ({{missing}})", body: "" }, {}).subject).toBe("Event ({{missing}})");
    expect(renderTemplate({ subject: "Notion 101 — {{x}}", body: "" }, {}).subject).toBe("Notion 101");
    expect(renderTemplate({ subject: "Notion 101 — ", body: "" }, {}).subject).toBe("Notion 101");
  });

  it("keeps a dash followed by real words (does not over-strip user subjects)", () => {
    expect(renderTemplate({ subject: "Save your spot — today", body: "" }, {}).subject).toBe("Save your spot — today");
    expect(renderTemplate({ subject: "You're in — {{ev}} 🎉", body: "" }, { ev: "Notion 101" }).subject).toBe("You're in — Notion 101 🎉");
  });
});
