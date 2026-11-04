import { describe, expect, it } from "vitest";
import { assertFetchableUrl, BlockedUrlError, createPinnedLookup, isPublicAddress } from "@/server/web/ssrf";
import {
  classifyContent,
  detectCharset,
  fetchUrl,
  htmlToMarkdown,
  MAX_TEXT_BYTES,
  type HttpRequester,
  type RawResponse,
} from "@/server/web/fetch-url";
import { fetchUrlTool } from "@/server/agent/tools/web";
import type { ToolContext, WebApi } from "@/server/agent/tools/types";

const enc = (s: string) => new TextEncoder().encode(s);

async function* chunks(...parts: Uint8Array[]) {
  for (const p of parts) yield p;
}

function response(status: number, headers: Record<string, string>, body: string | Uint8Array = ""): RawResponse {
  return { status, headers, body: chunks(typeof body === "string" ? enc(body) : body) };
}

/** Fake network: maps URL → response; records requested URLs. */
function fakeNet(routes: Record<string, () => RawResponse>) {
  const seen: string[] = [];
  const request: HttpRequester = async (url) => {
    seen.push(url.toString());
    const r = routes[url.toString()];
    if (!r) throw new Error(`unexpected request ${url}`);
    return r();
  };
  return { request, seen };
}

describe("isPublicAddress", () => {
  it.each([
    ["8.8.8.8", true],
    ["1.1.1.1", true],
    ["2606:4700:4700::1111", true],
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.16.0.1", false],
    ["192.168.1.1", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["224.0.0.1", false],
    ["255.255.255.255", false],
    ["::1", false],
    ["::", false],
    ["fe80::1", false],
    ["fd00::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:8.8.8.8", true],
    ["64:ff9b::7f00:1", false],
    ["2002:7f00:1::", false],
    ["not-an-ip", false],
  ])("%s → %s", (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

describe("assertFetchableUrl", () => {
  it("accepts public http(s) URLs and drops the fragment", () => {
    expect(assertFetchableUrl(" https://example.com/a?b=1#frag ").toString()).toBe("https://example.com/a?b=1");
  });

  it.each([
    ["ftp://example.com/x", /http and https/],
    ["file:///etc/passwd", /http and https/],
    ["javascript:alert(1)", /http and https/],
    ["https://user:pw@example.com", /credentials/],
    ["http://127.0.0.1:8080/", /Private/],
    ["http://[::1]/", /Private/],
    ["http://169.254.169.254/latest/meta-data", /Private/],
    ["http://localhost:3000", /Private/],
    ["http://foo.localhost", /Private/],
    ["not a url", /valid URL/],
  ])("rejects %s", (url, msg) => {
    expect(() => assertFetchableUrl(url)).toThrow(msg);
  });
});

describe("createPinnedLookup", () => {
  const run = (resolve: Parameters<typeof createPinnedLookup>[0], opts: { all?: boolean }) =>
    new Promise<{ err: Error | null; address: unknown; family?: number }>((done) =>
      createPinnedLookup(resolve)("example.com", opts, (err, address, family) => done({ err, address, family })),
    );

  it("returns validated addresses in both callback shapes", async () => {
    const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
    expect(await run(resolve, {})).toEqual({ err: null, address: "93.184.216.34", family: 4 });
    expect(await run(resolve, { all: true })).toEqual({ err: null, address: [{ address: "93.184.216.34", family: 4 }], family: undefined });
  });

  it("refuses when any resolved address is private (DNS rebinding)", async () => {
    const res = await run(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ], {});
    expect(res.err).toBeInstanceOf(BlockedUrlError);
    expect((res.err as NodeJS.ErrnoException).code).toBe("EBLOCKED");
  });
});

describe("content handling", () => {
  it("classifies by content type and sniffs octet-stream", () => {
    expect(classifyContent("text/html; charset=utf-8", enc(""))).toBe("html");
    expect(classifyContent("application/ld+json", enc(""))).toBe("text");
    expect(classifyContent("application/pdf", enc(""))).toBe("pdf");
    expect(classifyContent("image/png", enc(""))).toBe("unsupported");
    expect(classifyContent("", enc("%PDF-1.4"))).toBe("pdf");
    expect(classifyContent("application/octet-stream", enc("<!DOCTYPE html><html>"))).toBe("html");
    expect(classifyContent("", new Uint8Array([0, 1, 2]))).toBe("unsupported");
  });

  it("detects charset from header or meta", () => {
    expect(detectCharset("text/html; charset=ISO-8859-1", enc(""), true)).toBe("iso-8859-1");
    expect(detectCharset("text/html", enc('<meta charset="windows-1252">'), true)).toBe("windows-1252");
    expect(detectCharset("text/plain", enc(""), false)).toBe("utf-8");
  });

  it("converts an article to markdown with absolute links", async () => {
    const html = `<!doctype html><html><head><title>Doc Title</title><script>evil()</script></head><body>
      <nav>Menu stuff</nav>
      <article><h1>Heading</h1><p>${"Real content sentence. ".repeat(30)}</p>
      <p>See <a href="/docs/page">the docs</a>.</p><ul><li>One</li><li>Two</li></ul></article></body></html>`;
    const { title, markdown } = await htmlToMarkdown(html, "https://example.com/blog/post");
    expect(title).toBe("Doc Title");
    expect(markdown).toContain("Real content sentence.");
    expect(markdown).toContain("[the docs](https://example.com/docs/page)");
    expect(markdown).toMatch(/^- +One$/m);
    expect(markdown).not.toContain("evil()");
  });

  it("falls back to the body for short pages", async () => {
    const { markdown } = await htmlToMarkdown("<html><body><p>Tiny page</p><script>x()</script></body></html>", "https://e.com/");
    expect(markdown).toBe("Tiny page");
  });
});

describe("fetchUrl", () => {
  it("follows redirects and returns markdown", async () => {
    const net = fakeNet({
      "https://example.com/start": () => response(301, { location: "/final" }),
      "https://example.com/final": () =>
        response(200, { "content-type": "text/html" }, "<html><head><title>T</title></head><body><p>Hello world</p></body></html>"),
    });
    const page = await fetchUrl("https://example.com/start", { request: net.request });
    expect(net.seen).toEqual(["https://example.com/start", "https://example.com/final"]);
    expect(page).toMatchObject({ finalUrl: "https://example.com/final", status: 200, title: "T", content: "Hello world" });
  });

  it("re-validates every redirect hop", async () => {
    const net = fakeNet({
      "https://example.com/": () => response(302, { location: "http://169.254.169.254/latest/meta-data" }),
    });
    await expect(fetchUrl("https://example.com/", { request: net.request })).rejects.toBeInstanceOf(BlockedUrlError);
    expect(net.seen).toEqual(["https://example.com/"]);
  });

  it("caps redirects", async () => {
    const net = fakeNet(
      Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`https://e.com/${i}`, () => response(302, { location: `/${i + 1}` })]),
      ),
    );
    await expect(fetchUrl("https://e.com/0", { request: net.request })).rejects.toThrow(/Too many redirects/);
  });

  it("reports HTTP errors and unsupported types", async () => {
    const net = fakeNet({
      "https://e.com/404": () => response(404, {}),
      "https://e.com/img": () => response(200, { "content-type": "image/png" }, new Uint8Array([0x89, 0x50])),
    });
    await expect(fetchUrl("https://e.com/404", { request: net.request })).rejects.toThrow(/HTTP 404/);
    await expect(fetchUrl("https://e.com/img", { request: net.request })).rejects.toThrow(/image\/png/);
  });

  it("caps the body size and flags truncation", async () => {
    let cancelled = false;
    const big = new Uint8Array(MAX_TEXT_BYTES).fill(0x61);
    const net = fakeNet({
      "https://e.com/big.txt": () => ({
        status: 200,
        headers: { "content-type": "text/plain" },
        body: chunks(big, enc("tail")),
        cancel: () => {
          cancelled = true;
        },
      }),
    });
    const page = await fetchUrl("https://e.com/big.txt", { request: net.request });
    expect(page.truncatedBody).toBe(true);
    expect(page.content.length).toBe(MAX_TEXT_BYTES);
    expect(cancelled).toBe(true);
  });

  it("surfaces DNS-level blocks from the network layer", async () => {
    const request: HttpRequester = async () => {
      throw Object.assign(new Error("internal.example resolves to a private or internal address."), { code: "EBLOCKED" });
    };
    await expect(fetchUrl("https://internal.example/", { request })).rejects.toBeInstanceOf(BlockedUrlError);
  });
});

describe("fetch_url tool", () => {
  const ctx = (web?: WebApi): ToolContext => ({
    userId: "u",
    threadId: "t",
    rootThreadId: "t",
    runId: "r",
    messageId: "m",
    callId: "c",
    partIndex: 0,
    step: 0,
    signal: new AbortController().signal,
    emit: { patch: () => {}, log: () => {} },
    services: { web, steering: { onEnqueue: () => () => {}, hasPending: () => false } },
  });

  it("returns wrapped content with a display payload", async () => {
    const web: WebApi = {
      fetch: async () => ({
        url: "https://e.com/a",
        finalUrl: "https://e.com/b",
        status: 200,
        contentType: "text/html",
        title: "Page",
        content: "x".repeat(5000),
        truncatedBody: false,
      }),
    };
    const res = await fetchUrlTool.execute({ url: "https://e.com/a", max_chars: 1000 }, ctx(web));
    expect(res.output).toContain("Title: Page\nURL: https://e.com/b");
    expect(res.output).toContain("<fetched_content>");
    expect(res.output).toContain("Note: content truncated (5000 characters available).");
    expect(res.display).toMatchObject({ kind: "fetch", title: "Page", chars: 5000, truncated: true });
  });

  it("turns blocked URLs into tool errors", async () => {
    const web: WebApi = {
      fetch: async (url) => {
        assertFetchableUrl(url);
        throw new Error("unreachable");
      },
    };
    const res = await fetchUrlTool.execute({ url: "http://10.0.0.1/" }, ctx(web));
    expect(res).toEqual({ output: "Error: Private, local, and internal network addresses can't be fetched.", isError: true });
  });

  it("is gated by the admin flag", () => {
    const scope = (fetchUrlEnabled: boolean) => ({
      threadKind: "CHAT" as const,
      model: { supportsFunctionTools: true },
      flags: {
        sandboxEnabled: false,
        sandboxPythonEnabled: false,
        artifactsEnabled: false,
        inlineUiEnabled: false,
        fetchUrlEnabled,
        memoryEnabled: false,
        subagentsEnabled: false,
        subagentMaxConcurrent: 1,
        subagentModelCount: 0,
      },
    });
    expect(fetchUrlTool.available(scope(true))).toBe(true);
    expect(fetchUrlTool.available(scope(false))).toBe(false);
  });
});
