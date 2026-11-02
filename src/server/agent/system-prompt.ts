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

export function buildInstructions(args: InstructionArgs): string | null {
  const sections: string[] = [];
  const admin = args.adminPrompt?.trim();
  if (admin) sections.push(admin);
  if (args.toolNames.length > 0) sections.push(STEERING);
  const suffix = args.suffix?.trim();
  if (suffix) sections.push(suffix);
  return sections.length > 0 ? sections.join("\n\n") : null;
}
