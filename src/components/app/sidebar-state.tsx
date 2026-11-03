"use client";

import { createContext, useContext } from "react";

/** Whether the desktop sidebar is collapsed (the shell then shows floating toggle buttons at top-left). */
export const SidebarCollapsedContext = createContext(false);

export function useSidebarCollapsed() {
  return useContext(SidebarCollapsedContext);
}
