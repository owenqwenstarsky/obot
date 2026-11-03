/**
 * Runtime loaded inside the sandboxed artifact iframe (opaque origin, no network access).
 * Compiles a single-file React component (TSX/JSX) with sucrase and mounts it. Only `react`,
 * `react-dom`, and `lucide-react` can be imported. Styling comes from Tailwind's browser build.
 */
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import * as Lucide from "lucide-react";
import { compileArtifact } from "./compile";

const MODULES: Record<string, unknown> = {
  react: React,
  "react-dom": ReactDOM,
  "react-dom/client": ReactDOMClient,
  "react/jsx-runtime": JsxRuntime,
  "react/jsx-dev-runtime": JsxRuntime,
  "lucide-react": Lucide,
};

function post(msg: Record<string, unknown>) {
  try {
    window.parent.postMessage({ source: "obot-artifact", ...msg }, "*");
  } catch {
    // ignore
  }
}

function showError(message: string) {
  post({ type: "error", message });
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = "";
  const box = document.createElement("pre");
  box.className = "m-4 whitespace-pre-wrap rounded-lg border border-red-300 bg-red-50 p-4 font-mono text-sm text-red-800";
  box.textContent = message;
  root.appendChild(box);
}

class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    post({ type: "error", message: error.message });
  }
  render() {
    if (this.state.error) {
      return React.createElement(
        "pre",
        { className: "m-4 whitespace-pre-wrap rounded-lg border border-red-300 bg-red-50 p-4 font-mono text-sm text-red-800" },
        `Runtime error: ${this.state.error.message}`,
      );
    }
    return this.props.children;
  }
}

function compile(source: string): React.ComponentType {
  return compileArtifact<React.ComponentType>(source, MODULES, React);
}

function setTheme(theme: unknown) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function reportHeight() {
  const h = Math.ceil(document.documentElement.scrollHeight);
  post({ type: "height", height: h });
}

function boot() {
  const theme = document.documentElement.dataset.theme;
  setTheme(theme);
  window.addEventListener("message", (e) => {
    const d = e.data as { type?: string; theme?: string } | null;
    if (d?.type === "obot:theme") setTheme(d.theme);
  });
  new ResizeObserver(reportHeight).observe(document.documentElement);
  window.addEventListener("error", (e) => post({ type: "error", message: e.message }));

  const srcEl = document.getElementById("artifact-source");
  if (!srcEl) return;
  const mode = srcEl.dataset.kind;
  if (mode !== "react") return;
  try {
    const source = JSON.parse(srcEl.textContent || '""') as string;
    const Component = compile(source);
    ReactDOMClient.createRoot(document.getElementById("root")!).render(
      React.createElement(Boundary, null, React.createElement(Component)),
    );
    post({ type: "ready" });
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
