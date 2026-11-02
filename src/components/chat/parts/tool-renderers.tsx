"use client";

import type { ComponentType } from "react";
import type { FunctionToolPart } from "@/lib/parts";
import { BashBlock, WriteFileBlock } from "./bash-part";
import { ArtifactCard } from "./artifact-part";

/** Dedicated renderers for local function tools, keyed by tool name. */
export const toolRenderers: Record<string, ComponentType<{ part: FunctionToolPart }>> = {
  bash: BashBlock,
  write_file: WriteFileBlock,
  create_artifact: ArtifactCard,
  update_artifact: ArtifactCard,
};
