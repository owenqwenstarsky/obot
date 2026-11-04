"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ChatView } from "./chat-view";

/**
 * After the first message, the URL is rewritten to /t/<id> in place (no remount) so the
 * stream isn't interrupted. When the user navigates back to "/", bump a generation key so
 * a fresh, empty ChatView mounts.
 */
export function NewThreadView({ projectId = null }: { projectId?: string | null }) {
  const pathname = usePathname();
  const [state, setState] = useState({ path: pathname, gen: 0 });
  if (state.path !== pathname) {
    setState({ path: pathname, gen: pathname === "/" ? state.gen + 1 : state.gen });
  }
  return <ChatView key={`${state.gen}:${projectId ?? ""}`} threadId={null} projectId={projectId} />;
}
