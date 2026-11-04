import { describe, expect, it } from "vitest";
import { resolveArgCitations, stripCitationMarkers } from "@/lib/citations";
import { ResponseStreamNormalizer, type StreamEvent } from "@/server/llm/stream-normalizer";

const M = (...refs: string[]) => `cite${refs.join("")}`;

/** Raw JSON arguments plus a url_citation annotation whose offsets cover the marker (as the upstream sends them). */
function argsWithMarker(refs: string[]) {
  const marker = M(...refs);
  const before = '{"title":"Report","kind":"markdown","content":"# Report\\n\\nCourts blocked it. ';
  const args = `${before}${marker}\\n\\nMore."}`;
  return { args, start: before.length, end: before.length + marker.length };
}

describe("stripCitationMarkers", () => {
  it("removes complete markers and stray delimiters", () => {
    expect(stripCitationMarkers(`Fact. ${M("turn1search4", "turn1news18")} Next.`)).toBe("Fact.  Next.");
    expect(stripCitationMarkers("Half citeturn1 open")).toBe("Half citeturn1 open");
    expect(stripCitationMarkers("plain")).toBe("plain");
  });
});

describe("resolveArgCitations", () => {
  it("turns an annotated marker into a link and keeps the JSON valid", () => {
    const { args, start, end } = argsWithMarker(["turn844037view5"]);
    const url = "https://storage.courtlistener.com/recap/doc(1).pdf";
    const out = resolveArgCitations(args, [{ url, start, end }]);
    expect(JSON.parse(out).content).toBe(
      "# Report\n\nCourts blocked it.  ([storage.courtlistener.com](https://storage.courtlistener.com/recap/doc%281%29.pdf))\n\nMore.",
    );
  });

  it("joins several sources on one marker and dedupes repeats", () => {
    const { args, start, end } = argsWithMarker(["turn1search4", "turn1news18"]);
    const out = resolveArgCitations(args, [
      { url: "https://apnews.com/a", start, end },
      { url: "https://www.justsecurity.org/b", start, end },
      { url: "https://apnews.com/a", start, end },
    ]);
    expect(JSON.parse(out).content).toContain("([apnews.com](https://apnews.com/a), [justsecurity.org](https://www.justsecurity.org/b))");
  });

  it("drops markers that have no usable annotation (literal or JSON-escaped)", () => {
    const { args } = argsWithMarker(["turn1search4"]);
    expect(JSON.parse(resolveArgCitations(args, [{ url: "https://x.test", start: 0, end: 5 }])).content).not.toMatch(/[-]|cite/);
    const escaped = '{"content":"A \\ue200cite\\ue202turn1search4\\ue201 B"}';
    expect(JSON.parse(resolveArgCitations(escaped, [])).content).toBe("A  B");
  });

  it("leaves arguments without markers untouched", () => {
    const args = '{"command":"ls -la"}';
    expect(resolveArgCitations(args, [])).toBe(args);
  });
});

describe("ResponseStreamNormalizer with citations in tool arguments", () => {
  it("resolves annotations on a function call into its arguments", () => {
    const { args, start, end } = argsWithMarker(["turn844037view5"]);
    const n = new ResponseStreamNormalizer(() => 1000);
    const fc = { type: "function_call", id: "fc_1", call_id: "call_1", name: "create_artifact", arguments: "" };
    const events: StreamEvent[] = [
      { type: "response.output_item.added", item: fc },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: args.slice(0, end) },
      {
        type: "response.output_text.annotation.added",
        item_id: "fc_1",
        annotation: { type: "url_citation", url: "https://apnews.com/x", title: "AP", start_index: start, end_index: end },
      },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: args.slice(end) },
      { type: "response.function_call_arguments.done", item_id: "fc_1", arguments: args },
      { type: "response.output_item.done", item: { ...fc, arguments: args } },
      { type: "response.completed", response: { id: "r" } },
    ];
    for (const e of events) n.apply(e);
    const snap = n.snapshot();
    expect(snap.parts).toHaveLength(1);
    const content = JSON.parse(snap.functionCalls[0].arguments).content;
    expect(content).toContain("Courts blocked it.  ([apnews.com](https://apnews.com/x))");
    expect(content).not.toMatch(/[-]/);
    expect(snap.parts[0]).toMatchObject({ status: "pending", argsText: snap.functionCalls[0].arguments });
  });
});
