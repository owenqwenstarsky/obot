import { describe, expect, it } from "vitest";
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as Lucide from "lucide-react";
import { compileArtifact } from "../scripts/artifact-runtime/compile";

const modules = { react: React, "react/jsx-runtime": JsxRuntime, "lucide-react": Lucide };

describe("artifact runtime compile", () => {
  it("compiles a TSX component with hooks, types and lucide icons", () => {
    const C = compileArtifact<React.ComponentType>(
      `import { useState } from "react";
       import { Star } from "lucide-react";
       type Props = { start?: number };
       export default function Counter({ start = 2 }: Props) {
         const [n] = useState<number>(start);
         return <div className="p-4"><Star className="size-4" /> Count: {n}</div>;
       }`,
      modules,
      React,
    );
    const html = renderToStaticMarkup(React.createElement(C));
    expect(html).toContain('class="p-4"');
    expect(html).toContain("Count: 2");
    expect(html).toContain("<svg");
  });

  it("rejects disallowed imports and missing default exports", () => {
    expect(() => compileArtifact(`import fs from "fs"; export default () => (fs ? null : null);`, modules, React)).toThrow(/isn't available/);
    expect(() => compileArtifact(`export const x = 1;`, modules, React)).toThrow(/default-export/);
  });

  it("reports syntax errors", () => {
    expect(() => compileArtifact(`export default () => <div>`, modules, React)).toThrow();
  });
});
