/**
 * Builds the srcdoc for a sandboxed artifact iframe (sandbox="allow-scripts", no same-origin).
 * A strict CSP blocks all network access except the vendored runtime scripts served by Obot.
 */
export type FrameKind = "html" | "react";

export function artifactCsp(origin: string): string {
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${origin}/artifact-runtime/`,
    "style-src 'unsafe-inline'",
    "img-src data: blob: https:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** JSON that is safe to embed inside a <script> element. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function headTags(origin: string, theme: "light" | "dark") {
  return [
    `<meta charset="utf-8">`,
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(artifactCsp(origin))}">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta name="color-scheme" content="${theme === "dark" ? "dark light" : "light dark"}">`,
    `<script src="${origin}/artifact-runtime/tailwind.js"></script>`,
    `<style type="text/tailwindcss">@custom-variant dark (&:where(.dark, .dark *));</style>`,
  ].join("");
}

export function buildArtifactSrcDoc(kind: FrameKind, content: string, origin: string, theme: "light" | "dark"): string {
  const htmlAttrs = `data-theme="${theme}"${theme === "dark" ? ' class="dark"' : ""}`;
  const runtime = `<script src="${origin}/artifact-runtime/runtime.js"></script>`;
  if (kind === "react") {
    return [
      `<!doctype html><html ${htmlAttrs}><head>${headTags(origin, theme)}</head>`,
      `<body class="min-h-screen bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">`,
      `<div id="root"></div>`,
      `<script type="application/json" id="artifact-source" data-kind="react">${scriptJson(content)}</script>`,
      runtime,
      `</body></html>`,
    ].join("");
  }
  // HTML: inject our head tags first so the CSP applies before any of the artifact's own scripts.
  const head = headTags(origin, theme);
  let doc = content;
  if (/<head[^>]*>/i.test(doc)) doc = doc.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
  else if (/<html[^>]*>/i.test(doc)) doc = doc.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  else doc = `<!doctype html><html ${htmlAttrs}><head>${head}</head><body>${doc}</body></html>`;
  if (!/data-theme=/.test(doc)) doc = doc.replace(/<html([^>]*)>/i, `<html$1 ${htmlAttrs}>`);
  if (/<\/body>/i.test(doc)) doc = doc.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${runtime}</body>`);
  else doc += runtime;
  return doc;
}

export const ARTIFACT_EXTENSIONS: Record<"markdown" | "html" | "react", string> = {
  markdown: "md",
  html: "html",
  react: "tsx",
};

export function artifactFileName(title: string, kind: "markdown" | "html" | "react") {
  const base = title.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").slice(0, 60) || "artifact";
  return `${base}.${ARTIFACT_EXTENSIONS[kind]}`;
}
