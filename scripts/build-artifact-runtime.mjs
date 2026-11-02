// Bundles the sandboxed artifact runtime (React + lucide-react + sucrase) and copies Tailwind's
// browser build into public/artifact-runtime/. Runs before `next dev` and `next build`.
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public", "artifact-runtime");
const require = createRequire(import.meta.url);

await mkdir(out, { recursive: true });
await build({
  entryPoints: [path.join(root, "scripts", "artifact-runtime", "entry.tsx")],
  outfile: path.join(out, "runtime.js"),
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  logLevel: "warning",
});
await copyFile(require.resolve("@tailwindcss/browser"), path.join(out, "tailwind.js"));
console.log("artifact runtime built →", path.relative(root, out));
