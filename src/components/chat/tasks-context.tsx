"use client";

import { createContext, useContext } from "react";
import type { ClientTask } from "@/lib/run-events";

type TasksApi = { tasks: Map<string, ClientTask>; cancel: (taskId: string) => Promise<void> };

export const ChatTasksContext = createContext<TasksApi | null>(null);

export function useChatTasks() {
  return useContext(ChatTasksContext);
}
