import { transform } from "sucrase";

/**
 * Compile a single-file TSX/JSX artifact into a component. `modules` is the import allowlist;
 * anything else throws a clear error.
 */
export function compileArtifact<C>(source: string, modules: Record<string, unknown>, react: unknown): C {
  const { code } = transform(source, {
    transforms: ["typescript", "jsx", "imports"],
    jsxRuntime: "automatic",
    production: true,
  });
  const mod = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    if (name in modules) return modules[name];
    throw new Error(`"${name}" isn't available in artifacts. Only react and lucide-react can be imported.`);
  };
  new Function("require", "module", "exports", "React", code)(require, mod, mod.exports, react);
  const exported = mod.exports.default ?? Object.values(mod.exports).find((v) => typeof v === "function");
  if (typeof exported !== "function") throw new Error("The artifact must default-export a React component.");
  return exported as C;
}
