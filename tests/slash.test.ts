import { describe, expect, it } from "vitest";
import { expandPrompt, matchSlashCommands, normalizeCommand, slashQuery, type SlashPrompt } from "@/lib/slash";

const p = (command: string, scope: "USER" | "INSTANCE" = "USER", title = command): SlashPrompt => ({
  id: `${scope}:${command}`,
  command,
  title,
  body: `body of ${command}`,
  scope,
});

describe("normalizeCommand", () => {
  it("slugifies commands", () => {
    expect(normalizeCommand("/Summarize Text!")).toBe("summarize-text");
    expect(normalizeCommand("  Café_au lait ")).toBe("cafe_au-lait");
    expect(normalizeCommand("***")).toBe("");
    expect(normalizeCommand("x".repeat(80))).toHaveLength(40);
  });
});

describe("slashQuery", () => {
  it("only triggers for a lone /word", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/Sum")).toBe("sum");
    expect(slashQuery("/sum more")).toBeNull();
    expect(slashQuery("hello /sum")).toBeNull();
    expect(slashQuery("/a/b")).toBeNull();
    expect(slashQuery("")).toBeNull();
  });
});

describe("matchSlashCommands", () => {
  const prompts = [p("summarize"), p("sum"), p("translate", "USER", "Translate to French"), p("summarize", "INSTANCE"), p("review", "INSTANCE")];

  it("ranks exact, prefix, substring, then title matches", () => {
    expect(matchSlashCommands("sum", prompts).map((x) => x.command)).toEqual(["sum", "summarize"]);
    expect(matchSlashCommands("french", prompts).map((x) => x.command)).toEqual(["translate"]);
    expect(matchSlashCommands("view", prompts).map((x) => x.command)).toEqual(["review"]);
  });

  it("lets personal prompts shadow shared ones", () => {
    const hit = matchSlashCommands("summarize", prompts)[0];
    expect(hit.scope).toBe("USER");
    expect(matchSlashCommands("", prompts)).toHaveLength(4);
  });

  it("limits results", () => {
    const many = Array.from({ length: 20 }, (_, i) => p(`c${i}`));
    expect(matchSlashCommands("", many, 8)).toHaveLength(8);
  });
});

describe("expandPrompt", () => {
  it("places the caret at {{cursor}} and removes extra markers", () => {
    expect(expandPrompt("Translate:\n\n{{cursor}}\n\nThanks")).toEqual({ text: "Translate:\n\n\n\nThanks", cursor: 12 });
    expect(expandPrompt("a{{cursor}}b{{cursor}}c")).toEqual({ text: "abc", cursor: 1 });
    expect(expandPrompt("plain")).toEqual({ text: "plain", cursor: 5 });
  });
});
