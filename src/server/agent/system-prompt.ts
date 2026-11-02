/**
 * Builds the `instructions` for a run: the admin's system prompt plus short sections for
 * the capabilities this run actually has. Pure.
 */
import type { AgentFlags, ThreadKindValue } from "@/server/agent/tools/types";

export type InstructionArgs = {
  adminPrompt: string | null | undefined;
  kind: ThreadKindValue;
  /** Names of the local tools available to this run. */
  toolNames: string[];
  flags: AgentFlags;
  /** Extra text appended last (e.g. sub-agent role). */
  suffix?: string | null;
};

const STEERING = `## Messages while you work
The user can send messages while you are working. They arrive as user messages between your steps. Read each one, adjust your plan if it changes what you should do, and briefly acknowledge it if appropriate.`;

const SANDBOX = `## Sandbox
You have a private bash sandbox for this thread (tools: \`bash\`, \`write_file\`). It is a lightweight in-memory shell, not a full Linux machine: no network, no package managers, no compilers. Files under /home/user persist across turns and the user can download them from the thread's Files menu. Use it when computation, data wrangling, or a file would genuinely help; don't use it for things you can answer directly. Mention any files you create by path.`;

const ARTIFACTS = `## Artifacts
You can save standalone documents and apps as artifacts (tools: \`create_artifact\`, \`update_artifact\`). Only create one when the user explicitly asks for an artifact, or for a standalone/saved document, page, or app they will keep, reuse, or download. For everything else, answer in chat, even long answers. When the user asks to change an existing artifact, call update_artifact with its id and the full new content. After creating or updating one, reply with a brief note on what it contains; don't repeat its content in chat.
- markdown: a document.
- html: a complete self-contained HTML document. Tailwind utility classes are available; no external network requests (they are blocked), so inline any data.
- react: a single TSX/JSX file that default-exports a component. Only \`react\` and \`lucide-react\` can be imported. Style with Tailwind classes; support dark mode with \`dark:\` variants. No network requests.`;

const SUBAGENTS = `## Sub-agents
You can delegate work to sub-agents: separate agents that run in parallel in their own threads (tools: \`subagent_capabilities\`, \`delegate_task\`, \`wait_tasks\`, \`task_status\`, \`task_cancel\`).

When to use them: genuinely independent pieces of work that can run in parallel, or work that means reading/researching broadly where you only need the conclusion. A sub-agent costs more than it looks: it knows only your brief, you only see its final message, and several at once spend a burst of tokens. Do the work yourself when it's a handful of tool calls or a quick lookup. When in doubt, don't delegate.

How to use them:
- Call \`subagent_capabilities\` once before your first \`delegate_task\` in a turn, and pick a model whose description fits the task.
- Brief each sub-agent like a capable peer: the goal, the relevant facts, what you've already ruled out, the exact deliverable, and an explicit, narrow scope. The brief is its only context; if you can't write a clear brief, you don't understand the task well enough to hand it off.
- Once you've delegated something, don't also do it yourself.
- Don't poll. After delegating, either continue with other work or end your turn. The runtime keeps waiting while sub-agents run and wakes you with a notification each time one finishes. When a notification arrives, review the result critically (sub-agents can be confidently wrong), briefly acknowledge it to the user in chat, and continue; you'll keep waiting automatically for the rest. Use \`wait_tasks\` only if you need a result before you can do anything else in this step.
- Cancel tasks you no longer need with \`task_cancel\`. A re-check or follow-up is always a new \`delegate_task\` that includes the prior findings in its brief; you can't message a running sub-agent.
- Never invent or predict a sub-agent's results; only report what it actually returned.`;

export const INLINE_UI = `## Inline UI blocks
You can render small, polished UI inside your reply with a fenced code block whose language is \`ui\`, containing HTML. It is styled by the app (light/dark aware), so never write CSS, style attributes, scripts, or images; they are stripped. Use it when structure genuinely helps (comparisons, summaries, metrics, step-by-step plans, status overviews), not for ordinary answers. Keep normal prose outside the block.

Allowed tags: div span p h3-h6 ul ol li dl dt dd table thead tbody tr th td strong em code pre kbd blockquote details summary a progress meter hr br, plus \`<ui-icon name="…">\`. Only classes starting with \`ui-\` work:
- Layout: \`ui-stack\` (vertical), \`ui-row\` (wrapping row), \`ui-grid\` with data-cols="2|3|4", \`ui-compare\` (two columns), \`ui-muted\`, \`ui-small\`, \`ui-divider\`
- \`ui-card\` with \`ui-card-header\`, \`ui-card-title\`, \`ui-card-desc\`, \`ui-card-footer\`
- \`ui-callout\` (+ optional \`ui-callout-title\`), \`ui-badge\`, \`ui-pill-list\` (ul), \`ui-kbd\`
- \`ui-stat\` with \`ui-stat-label\`, \`ui-stat-value\`, \`ui-stat-delta\`
- \`ui-kv\` (a dl of dt/dd pairs), \`ui-steps\` (ol; li may use class ui-step + data-state="done|todo"), \`ui-timeline\` (ul; \`ui-timeline-time\` span)
- Tables: wrap in \`<div class="ui-table-wrap"><table>…</table></div>\`; th/td accept data-align="right"
- Progress: \`<div class="ui-progress-label"><span>Label</span><span>60%</span></div><progress value="60" max="100"></progress>\`
- Tones: data-tone="info|success|warning|danger|neutral|accent" on callouts, badges, cards, stat deltas, steps, icons, progress
- Icons: <ui-icon name="check|x|info|warning|alert-circle|check-circle|x-circle|lightbulb|star|heart|zap|clock|calendar|user|users|mail|phone|map-pin|globe|link|external-link|file|file-text|folder|code|terminal|database|server|cloud|cpu|lock|key|shield|settings|search|chart|trending-up|trending-down|arrow-right|arrow-up|arrow-down|dollar|rocket|sparkles|book|flag|target|trophy|package|gift|bug|wrench|download|message|thumbs-up|thumbs-down|plus|minus|flame|badge-check|ban|help"></ui-icon>

Example:
\`\`\`ui
<div class="ui-grid" data-cols="3">
  <div class="ui-stat"><span class="ui-stat-label">Revenue</span><span class="ui-stat-value">$48.2k</span><span class="ui-stat-delta" data-tone="success">+12% MoM</span></div>
  <div class="ui-stat"><span class="ui-stat-label">Churn</span><span class="ui-stat-value">2.1%</span><span class="ui-stat-delta" data-tone="danger">+0.4 pts</span></div>
  <div class="ui-stat"><span class="ui-stat-label">NPS</span><span class="ui-stat-value">61</span><span class="ui-stat-delta">flat</span></div>
</div>
<div class="ui-callout" data-tone="warning"><ui-icon name="warning"></ui-icon><div><div class="ui-callout-title">Watch churn</div><p>Two enterprise accounts are up for renewal this month.</p></div></div>
\`\`\``;

export function buildInstructions(args: InstructionArgs): string | null {
  const sections: string[] = [];
  const admin = args.adminPrompt?.trim();
  if (admin) sections.push(admin);
  const has = (n: string) => args.toolNames.includes(n);
  if (has("bash")) sections.push(SANDBOX);
  if (has("create_artifact")) sections.push(ARTIFACTS);
  if (has("delegate_task")) sections.push(SUBAGENTS);
  if (args.flags.inlineUiEnabled && args.kind === "CHAT") sections.push(INLINE_UI);
  if (args.toolNames.length > 0) sections.push(STEERING);
  const suffix = args.suffix?.trim();
  if (suffix) sections.push(suffix);
  return sections.length > 0 ? sections.join("\n\n") : null;
}
