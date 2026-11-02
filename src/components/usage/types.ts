export type UsageReport = {
  timeZone: string;
  totals: {
    requests: number;
    costMicros: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    webSearchCalls: number;
  };
  byDay: { day: string; modelId: string; costMicros: number; requests: number; tokens: number }[];
  byModel: {
    modelId: string;
    requests: number;
    costMicros: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    webSearchCalls: number;
  }[];
};

export type UsageRecordRow = {
  id: string;
  createdAt: string;
  userEmail: string;
  userName: string;
  threadId: string | null;
  kind: "CHAT" | "TITLE";
  modelId: string;
  effort: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  webSearchCalls: number;
  costMicros: number;
  priced: boolean;
  note: string | null;
};
