/** Pure helpers for project context (testable without the database). */
import { truncateMiddle } from "@/server/llm/transcript";

export const PROJECT_FILE_CHARS = 30_000;
export const PROJECT_TOTAL_CHARS = 100_000;

export type ProjectContextFile = {
  fileName: string;
  text: string;
  /** Present when the file was also copied into the sandbox. */
  sandboxPath?: string | null;
  truncated: boolean;
  /** Not included at all because the total budget ran out. */
  omitted: boolean;
};

export type ProjectContext = {
  name: string;
  instructions: string | null;
  files: ProjectContextFile[];
};

/** Apply per-file and total caps (in file order) to a project's reference files. */
export function buildProjectContext(input: {
  name: string;
  instructions: string | null;
  files: { fileName: string; text: string; sandboxPath?: string | null }[];
}): ProjectContext {
  let budget = PROJECT_TOTAL_CHARS;
  const files: ProjectContextFile[] = input.files.map((f) => {
    if (budget <= 0) return { fileName: f.fileName, text: "", sandboxPath: f.sandboxPath, truncated: false, omitted: true };
    const cap = Math.min(PROJECT_FILE_CHARS, budget);
    const text = truncateMiddle(f.text, cap);
    budget -= text.length;
    return { fileName: f.fileName, text, sandboxPath: f.sandboxPath, truncated: text.length !== f.text.length, omitted: false };
  });
  return { name: input.name, instructions: input.instructions?.trim() || null, files };
}
