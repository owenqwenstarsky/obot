import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import { filterClassTokens, sanitizeInlineUi } from "@/lib/inline-ui-sanitize";
import { buildInstructions, INLINE_UI } from "@/server/agent/system-prompt";

const purify = createDOMPurify(new JSDOM("").window as unknown as Window & typeof globalThis);
const clean = (html: string) => sanitizeInlineUi(purify, html);

describe("inline UI sanitizer", () => {
  it("keeps kit markup intact", () => {
    const html =
      '<div class="ui-card" data-tone="success"><div class="ui-card-title"><ui-icon name="check" data-tone="success"></ui-icon> Done</div>' +
      '<progress value="60" max="100"></progress><details open><summary>More</summary><p>Hi</p></details></div>';
    expect(clean(html)).toBe(html.replace("<details open>", '<details open="">'));
  });

  it("strips scripts, styles, event handlers, images, iframes and forms", () => {
    const out = clean(
      '<div class="ui-card" style="color:red" onclick="alert(1)">x<script>alert(1)</script><style>*{}</style>' +
        '<img src="https://x/y.png" onerror="alert(1)"><iframe src="https://evil"></iframe><form><input name="a"></form><svg><circle/></svg></div>',
    );
    expect(out).toBe('<div class="ui-card">x</div>');
  });

  it("reduces classes to ui-* tokens and drops unknown ones", () => {
    expect(clean('<div class="ui-grid fixed inset-0 z-50 ui-card">a</div>')).toBe('<div class="ui-grid ui-card">a</div>');
    expect(clean('<div class="bg-red-500">a</div>')).toBe("<div>a</div>");
    expect(filterClassTokens("ui-a  ui-B x ui-c")).toBe("ui-a ui-c");
  });

  it("forces safe links and removes javascript: urls", () => {
    expect(clean('<a href="https://example.com" target="_self">ok</a>')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">ok</a>',
    );
    expect(clean('<a href="javascript:alert(1)">bad</a>')).toBe('<a target="_blank" rel="noopener noreferrer">bad</a>');
    expect(clean('<a href="data:text/html,hi">bad</a>')).not.toContain("data:");
  });

  it("validates data attributes, numbers and unknown attributes", () => {
    expect(clean('<span class="ui-badge" data-tone="red; x:y" data-foo="1" id="a">b</span>')).toBe('<span class="ui-badge">b</span>');
    expect(clean('<progress value="abc" max="100"></progress>')).toBe('<progress max="100"></progress>');
    expect(clean('<table><tbody><tr><td colspan="2" rowspan="x">x</td></tr></tbody></table>')).toBe(
      '<table><tbody><tr><td colspan="2">x</td></tr></tbody></table>',
    );
  });

  it("handles partial HTML while streaming", () => {
    expect(clean('<div class="ui-card"><div class="ui-card-title">Hel')).toBe('<div class="ui-card"><div class="ui-card-title">Hel</div></div>');
  });

  it("only allows the ui-icon custom element", () => {
    expect(clean('<ui-icon name="star"></ui-icon><my-widget>x</my-widget>')).toBe('<ui-icon name="star"></ui-icon>x');
    expect(clean('<ui-icon name="bad name!"></ui-icon>')).toBe("<ui-icon></ui-icon>");
  });
});

describe("inline UI prompt", () => {
  const flags = {
    sandboxEnabled: false,
    sandboxPythonEnabled: false,
    artifactsEnabled: false,
    inlineUiEnabled: true,
    fetchUrlEnabled: true,
    memoryEnabled: false,
    subagentsEnabled: false,
    subagentMaxConcurrent: 4,
    subagentModelCount: 0,
  };
  it("is included for chat threads only when enabled", () => {
    expect(buildInstructions({ adminPrompt: null, kind: "CHAT", toolNames: [], flags })).toContain(INLINE_UI);
    expect(buildInstructions({ adminPrompt: null, kind: "SUBAGENT", toolNames: [], flags }) ?? "").not.toContain("Inline UI");
    expect(buildInstructions({ adminPrompt: null, kind: "CHAT", toolNames: [], flags: { ...flags, inlineUiEnabled: false } })).toBeNull();
  });
});
