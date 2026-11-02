/**
 * Sanitizer for model-authored inline UI (```ui blocks). Works with any DOMPurify instance
 * (browser window or jsdom in tests). Policy:
 * - a small allowlist of structural/text tags plus <ui-icon name="…">
 * - no scripts, styles, event handlers, forms, media, iframes or images
 * - `class` is reduced to `ui-*` tokens (the Obot UI kit)
 * - data-tone/cols/size/state/align with short safe values
 * - links: http(s)/mailto only, always opened in a new tab without opener/referrer
 */
import type { DOMPurify } from "dompurify";

export const INLINE_UI_TAGS = [
  "div", "span", "p", "br", "hr",
  "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "strong", "b", "em", "i", "u", "s", "small", "sub", "sup", "mark",
  "code", "pre", "kbd", "blockquote",
  "details", "summary",
  "a", "progress", "meter",
  "ui-icon",
];

export const INLINE_UI_ATTRS = [
  "class", "title", "aria-label",
  "data-tone", "data-cols", "data-size", "data-state", "data-align",
  "open", "colspan", "rowspan",
  "value", "max", "min", "low", "high", "optimum",
  "href", "target", "rel", "name",
];

const CLASS_TOKEN = /^ui-[a-z0-9-]{1,40}$/;
const DATA_VALUE = /^[a-z0-9-]{1,20}$/;
const NUMERIC = /^-?\d+(\.\d+)?$/;
const SAFE_HREF = /^(https?:|mailto:)/i;

export function filterClassTokens(value: string): string {
  return value
    .split(/\s+/)
    .filter((t) => CLASS_TOKEN.test(t))
    .slice(0, 12)
    .join(" ");
}

type Hooked = DOMPurify & { __obotInlineUi?: true };

function installHooks(purify: Hooked) {
  if (purify.__obotInlineUi) return;
  purify.__obotInlineUi = true;
  purify.addHook("uponSanitizeAttribute", (_node, data) => {
    const name = data.attrName;
    const value = data.attrValue ?? "";
    if (name === "class") {
      const filtered = filterClassTokens(value);
      if (filtered) data.attrValue = filtered;
      else data.keepAttr = false;
    } else if (name.startsWith("data-")) {
      if (!DATA_VALUE.test(value)) data.keepAttr = false;
    } else if (name === "href") {
      if (!SAFE_HREF.test(value.trim())) data.keepAttr = false;
    } else if (["value", "max", "min", "low", "high", "optimum", "colspan", "rowspan"].includes(name)) {
      if (!NUMERIC.test(value.trim())) data.keepAttr = false;
    } else if (name === "name") {
      if (!DATA_VALUE.test(value)) data.keepAttr = false;
    }
  });
  purify.addHook("afterSanitizeAttributes", (node) => {
    const el = node as Element;
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    } else {
      el.removeAttribute?.("target");
      el.removeAttribute?.("rel");
    }
  });
}

function config() {
  return {
    ALLOWED_TAGS: INLINE_UI_TAGS,
    ALLOWED_ATTR: INLINE_UI_ATTRS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    CUSTOM_ELEMENT_HANDLING: {
      tagNameCheck: /^ui-icon$/,
      attributeNameCheck: /^(name|class|data-tone|data-size|aria-label|title)$/,
      allowCustomizedBuiltInElements: false,
    },
  };
}

export function sanitizeInlineUi(purify: DOMPurify, html: string): string {
  installHooks(purify as Hooked);
  return purify.sanitize(html, { ...config(), RETURN_TRUSTED_TYPE: false }) as unknown as string;
}

export function sanitizeInlineUiToFragment(purify: DOMPurify, html: string): DocumentFragment {
  installHooks(purify as Hooked);
  return purify.sanitize(html, { ...config(), RETURN_DOM_FRAGMENT: true }) as DocumentFragment;
}
