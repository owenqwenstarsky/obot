"use client";

import type { ComponentType } from "react";
import type { FunctionToolPart } from "@/lib/parts";
import { BashBlock, WriteFileBlock } from "./bash-part";
import { ArtifactCard } from "./artifact-part";
import { DelegateCard, SubagentMiniLine } from "./subagent-part";
import { FetchUrlBlock } from "./fetch-part";
import { MemoryBlock } from "./memory-part";

/** Dedicated renderers for local function tools, keyed by tool name. */
export const toolRenderers: Record<string, ComponentType<{ part: FunctionToolPart }>> = {
  bash: BashBlock,
  write_file: WriteFileBlock,
  fetch_url: FetchUrlBlock,
  remember: MemoryBlock,
  forget: MemoryBlock,
  create_artifact: ArtifactCard,
  update_artifact: ArtifactCard,
  delegate_task: DelegateCard,
  subagent_capabilities: SubagentMiniLine,
  wait_tasks: SubagentMiniLine,
  task_status: SubagentMiniLine,
  task_cancel: SubagentMiniLine,
};
