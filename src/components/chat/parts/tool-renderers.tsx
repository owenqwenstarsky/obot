"use client";

import type { ComponentType } from "react";
import type { FunctionToolPart } from "@/lib/parts";
import { BashBlock, WriteFileBlock } from "./bash-part";

/** Dedicated renderers for local function tools, keyed by tool name. */
export const toolRenderers: Record<string, ComponentType<{ part: FunctionToolPart }>> = {
  bash: BashBlock,
  write_file: WriteFileBlock,
};
