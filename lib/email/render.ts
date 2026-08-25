function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Blank line = new paragraph; consecutive non-blank lines join with <br/>. */
function toParagraphs(bodyLines: string[], fmt: (s: string) => string): string {
  const paras: string[][] = [];
  let cur: string[] = [];
  for (const l of bodyLines) {
    if (l.trim() === "") { if (cur.length) { paras.push(cur); cur = []; } }
    else cur.push(l);
  }
  if (cur.length) paras.push(cur);
  return paras
    .map((p) => `<p style="margin:0 0 10px;line-height:1.45">${p.map(fmt).join("<br/>")}</p>`)
    .join("");
}

function inlineFormat(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" style="font-weight:700">$1</a>');
  out = out.replace(/(^|[^"=>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" style="font-weight:700">$2</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out;
}

function stripInline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1: $2")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");
}

/** Replace {{token}} with known values; unknown tokens are left untouched. */
export function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Drop empty "()", dangling "— <rest>"/"at", collapse spaces. */
function cleanupSubject(s: string): string {
  return s.replace(/\s*\(\s*\)/g, "").replace(/\s+—\s*\S*\s*$/i, "").replace(/\s+(at)\s*$/i, "").replace(/\s{2,}/g, " ").trim();
}

const wrapDiv = (inner: string) =>
  `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:520px">${inner}</div>`;

/** Render an editable template's subject + body against placeholder values. */
export function renderTemplate(
  content: { subject: string; body: string },
  vars: Record<string, string>,
): { subject: string; html: string; text: string } {
  const subject = cleanupSubject(substitute(content.subject, vars));
  const lines = substitute(content.body, vars).split("\n");
  return {
    subject,
    html: wrapDiv(toParagraphs(lines, inlineFormat)),
    text: lines.map(stripInline).join("\n"),
  };
}
