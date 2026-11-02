"use client";

import { createElement, Fragment, memo, useMemo, type ReactNode } from "react";
import DOMPurify from "dompurify";
import type { CustomRendererProps } from "streamdown";
import { sanitizeInlineUiToFragment } from "@/lib/inline-ui-sanitize";
import { INLINE_UI_ICONS } from "./icons";

const ATTR_TO_PROP: Record<string, string> = {
  class: "className",
  colspan: "colSpan",
  rowspan: "rowSpan",
};

/** Convert a sanitized DOM tree into React elements, mapping <ui-icon> to lucide icons. */
function toReact(node: Node, key: string): ReactNode {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === "ui-icon") {
    const Icon = INLINE_UI_ICONS[el.getAttribute("name") ?? ""];
    if (!Icon) return null;
    const cls = ["ui-icon", el.getAttribute("class") ?? ""].join(" ").trim();
    return (
      <Icon
        key={key}
        className={cls}
        data-tone={el.getAttribute("data-tone") ?? undefined}
        data-size={el.getAttribute("data-size") ?? undefined}
        aria-label={el.getAttribute("aria-label") ?? undefined}
        aria-hidden={el.getAttribute("aria-label") ? undefined : true}
      />
    );
  }
  const props: Record<string, unknown> = { key };
  for (const attr of Array.from(el.attributes)) {
    const name = ATTR_TO_PROP[attr.name] ?? attr.name;
    if (attr.name === "open") props.open = true;
    else props[name] = attr.value;
  }
  if (tag === "details") props.suppressHydrationWarning = true;
  const children = Array.from(el.childNodes).map((c, i) => toReact(c, `${key}.${i}`));
  const voidTag = tag === "br" || tag === "hr";
  return createElement(tag, props, voidTag ? undefined : children);
}

function InlineUiImpl({ html }: { html: string }) {
  const content = useMemo(() => {
    if (typeof window === "undefined") return null;
    const frag = sanitizeInlineUiToFragment(DOMPurify, html);
    return Array.from(frag.childNodes).map((n, i) => toReact(n, String(i)));
  }, [html]);
  return <div className="obot-ui not-prose">{content ?? <Fragment />}</div>;
}

export const InlineUi = memo(InlineUiImpl);

/** Streamdown custom renderer for ```ui fences. Re-sanitizes on every streaming update. */
export function InlineUiRenderer({ code }: CustomRendererProps) {
  return <InlineUi html={code} />;
}
