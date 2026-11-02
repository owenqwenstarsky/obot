import "server-only";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses";
import { db } from "@/server/db";
import { llm } from "@/server/llm/client";
import { getSelectableModel, getSelectableModels } from "@/server/llm/models";
import { ResponseStreamNormalizer, type StreamEvent } from "@/server/llm/stream-normalizer";
import { checkCanRun, recordUsage } from "@/server/billing/usage";
import { getSettings } from "@/server/settings";
import { resolveEffort } from "@/lib/efforts";
import { partsToText } from "@/lib/parts";
import { cleanTitle, fallbackTitle } from "@/server/agent/title-text";

const TITLE_INSTRUCTIONS =
  "You name chat threads. Reply with a short, specific title (2-6 words) for the conversation that starts with the user's message. No quotes, no trailing punctuation, no emoji. Reply with the title only.";

/** Generates a thread title. Never throws; always resolves to some title. */
export async function generateTitle(args: {
  userId: string;
  threadId: string;
  firstMessage: string;
  fallbackModelId: string;
}): Promise<string> {
  const fallback = fallbackTitle(args.firstMessage);
  try {
    const settings = await getSettings();
    let model = settings.titleModelId ? await getSelectableModel(settings.titleModelId) : null;
    if (!model) {
      const all = await getSelectableModels();
      model = all.find((m) => m.id === "gpt-6-luna") ?? (await getSelectableModel(args.fallbackModelId));
    }
    if (!model || !args.firstMessage.trim()) return fallback;

    const gate = await checkCanRun(args.userId, model.hasPrice);
    if (!gate.allowed) return fallback;

    const effort = model.supportsReasoning
      ? resolveEffort(settings.titleEffort ?? "none", model.efforts, model.efforts[0])
      : null;

    const body = {
      model: model.id,
      instructions: TITLE_INSTRUCTIONS,
      input: [{ role: "user", content: [{ type: "input_text", text: args.firstMessage.slice(0, 4000) }] }],
      ...(effort ? { reasoning: { effort } } : {}),
      stream: true,
      store: false,
    };
    const stream = (await llm().responses.create(body as unknown as ResponseCreateParamsStreaming, {
      signal: AbortSignal.timeout(60_000),
    })) as unknown as AsyncIterable<StreamEvent>;
    const normalizer = new ResponseStreamNormalizer();
    for await (const ev of stream) normalizer.apply(ev);
    const snap = normalizer.snapshot();

    if (snap.usage) {
      await recordUsage({
        userId: args.userId,
        threadId: args.threadId,
        kind: "TITLE",
        modelId: model.id,
        effort,
        usage: snap.usage,
        webSearchCalls: 0,
        responseId: snap.responseId,
      });
    }
    const title = cleanTitle(partsToText(snap.parts));
    return title || fallback;
  } catch (err) {
    console.error("[titles] generation failed", err);
    return fallback;
  }
}

export async function applyTitle(threadId: string, title: string) {
  await db.thread.updateMany({
    where: { id: threadId, titleGenerated: false },
    data: { title, titleGenerated: true },
  });
}
