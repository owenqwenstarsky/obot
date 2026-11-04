"use client";

import { createContext, useContext } from "react";

/**
 * How messages are being viewed. The owner's chat uses the defaults; public share pages
 * are read-only and serve attachments through the share's token-scoped route.
 */
export type MessageViewContext = {
  readOnly: boolean;
  attachmentUrl: (attachmentId: string) => string;
};

const defaultContext: MessageViewContext = {
  readOnly: false,
  attachmentUrl: (id) => `/api/uploads/${id}`,
};

export const MessageViewCtx = createContext<MessageViewContext>(defaultContext);

export function useMessageView(): MessageViewContext {
  return useContext(MessageViewCtx);
}
