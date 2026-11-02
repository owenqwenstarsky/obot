"use client";

import { createContext, useContext } from "react";

export type ShellUser = { id: string; name: string; email: string; role: "USER" | "ADMIN" };

export const UserContext = createContext<ShellUser | null>(null);

export function useShellUser(): ShellUser {
  const user = useContext(UserContext);
  if (!user) throw new Error("useShellUser must be used inside AppShell");
  return user;
}
