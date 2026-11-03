import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyUpload,
  contentDisposition,
  decodeUtf8Text,
  fileExtension,
  sanitizeFileName,
} from "@/server/uploads/document-type";
import { extractDocumentText, joinPdfPages } from "@/server/uploads/extract";
import { buildInput, DOCUMENT_PROMPT_CHARS, documentInputText, type HistoryMessage } from "@/server/llm/request-builder";
import { SandboxService } from "@/server/sandbox/sandbox";

const enc = (s: string) => new TextEncoder().encode(s);

/** Builds a tiny valid one-page PDF with the given text (correct xref offsets). */
function makePdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(out);
}

describe("classifyUpload", () => {
  it("detects images from magic bytes regardless of name", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(classifyUpload("notes.txt", png)).toEqual({ kind: "image", mime: "image/png" });
  });

  it("detects PDFs from magic bytes", () => {
    expect(classifyUpload("report", enc("%PDF-1.7\n..."))).toEqual({ kind: "pdf", mime: "application/pdf" });
  });

  it("accepts UTF-8 text with an allowlisted extension", () => {
    expect(classifyUpload("data.CSV", enc("a,b\n1,2\n"))).toEqual({ kind: "text", mime: "text/csv" });
    expect(classifyUpload("main.py", enc("print('héllo')"))).toEqual({ kind: "text", mime: "text/x-python" });
  });

  it("rejects binary disguised as text, NUL bytes, and unknown extensions", () => {
    expect(classifyUpload("x.txt", new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull();
    expect(classifyUpload("x.txt", new Uint8Array([0x61, 0x00, 0x62]))).toBeNull();
    expect(classifyUpload("x.exe", enc("hello"))).toBeNull();
    expect(classifyUpload("README", enc("hello"))).toBeNull();
  });

  it("strips a UTF-8 BOM when decoding", () => {
    expect(decodeUtf8Text(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe("hi");
  });

  it("parses extensions", () => {
    expect(fileExtension("a/b/c.tar.GZ")).toBe("gz");
    expect(fileExtension(".env")).toBe("");
  });
});

describe("file names", () => {
  it("sanitizes names for the sandbox and headers", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("my report (final).pdf")).toBe("my report _final_.pdf");
    expect(sanitizeFileName("...")).toBe("file");
    expect(sanitizeFileName("naïve.md")).toBe("naïve.md");
  });

  it("encodes Content-Disposition safely", () => {
    expect(contentDisposition("attachment", 'ré"sumé.pdf')).toBe(
      `attachment; filename="r__sum_.pdf"; filename*=UTF-8''r%C3%A9%22sum%C3%A9.pdf`,
    );
  });
});

describe("extraction", () => {
  it("joins PDF pages with markers", () => {
    expect(joinPdfPages(["one"])).toBe("one");
    expect(joinPdfPages(["one ", " two"])).toBe("--- Page 1 ---\none\n\n--- Page 2 ---\ntwo");
  });

  it("extracts text from a real PDF", async () => {
    const res = await extractDocumentText("pdf", makePdf("Hello Obot PDF"));
    expect(res.pageCount).toBe(1);
    expect(res.text).toContain("Hello Obot PDF");
  });

  it("never throws on a broken PDF", async () => {
    expect(await extractDocumentText("pdf", enc("%PDF-1.4 garbage"))).toEqual({ text: "", pageCount: null });
  });
});

describe("documents in model input", () => {
  const part = { fileName: 'a "b".csv', sandboxPath: "/home/user/uploads/a b.csv" };

  it("wraps document text with escaped attributes", () => {
    expect(documentInputText(part, { fileName: "a.csv", text: "x,y" })).toBe(
      `<document name="a &quot;b&quot;.csv" sandbox_path="/home/user/uploads/a b.csv">\nx,y\n</document>`,
    );
  });

  it("truncates long documents and points at the sandbox copy", () => {
    const out = documentInputText(part, { fileName: "a.csv", text: "z".repeat(DOCUMENT_PROMPT_CHARS + 10) });
    expect(out).toContain(`truncated="true"`);
    expect(out).toContain(`total_chars="${DOCUMENT_PROMPT_CHARS + 10}"`);
    expect(out).toContain("The full file is at /home/user/uploads/a b.csv");
    expect(out.length).toBeLessThan(DOCUMENT_PROMPT_CHARS + 500);
  });

  it("uses placeholders for missing or empty documents", () => {
    expect(documentInputText({ fileName: "a.pdf" }, null)).toContain("no longer available");
    expect(documentInputText({ fileName: "a.pdf" }, { fileName: "a.pdf", text: "  " })).toContain("No text could be extracted");
  });

  it("turns user_file parts into input_text in order", () => {
    const history: HistoryMessage[] = [
      {
        role: "USER",
        parts: [
          { type: "user_file", id: "f", attachmentId: "doc1", fileName: "n.md", mime: "text/markdown", size: 3 },
          { type: "user_text", id: "t", text: "Summarize" },
        ],
      },
    ];
    const items = buildInput(history, () => null, (id) => (id === "doc1" ? { fileName: "n.md", text: "# Hi" } : null));
    expect(items).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: `<document name="n.md">\n# Hi\n</document>` },
          { type: "input_text", text: "Summarize" },
        ],
      },
    ]);
  });
});

describe("sandbox file copies", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "obot-docs-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes bytes and dedupes names in unique mode", async () => {
    const s = new SandboxService({ dir, python: () => false });
    const a = await s.addFiles("t", "uploads", [{ name: "a.txt", bytes: enc("one") }], "unique");
    const b = await s.addFiles("t", "uploads", [{ name: "a.txt", bytes: enc("two") }, { name: "a.txt", bytes: enc("3") }], "unique");
    expect(a).toEqual(["/home/user/uploads/a.txt"]);
    expect(b).toEqual(["/home/user/uploads/a-1.txt", "/home/user/uploads/a-2.txt"]);
    expect(new TextDecoder().decode((await s.read("t", "uploads/a-1.txt"))!)).toBe("two");
  });

  it("skips existing files in skip-existing mode", async () => {
    const s = new SandboxService({ dir, python: () => false });
    await s.addFiles("t", "project", [{ name: "p.md", bytes: enc("v1") }], "skip-existing");
    const again = await s.addFiles("t", "project", [{ name: "p.md", bytes: enc("v2") }], "skip-existing");
    expect(again).toEqual(["/home/user/project/p.md"]);
    expect(new TextDecoder().decode((await s.read("t", "project/p.md"))!)).toBe("v1");
  });

  it("writes binary content with writeFile", async () => {
    const s = new SandboxService({ dir, python: () => false });
    const res = await s.writeFile("t", "bin.dat", new Uint8Array([0, 1, 2, 255]));
    expect(res).toEqual({ path: "/home/user/bin.dat", bytes: 4 });
    expect(Array.from((await s.read("t", "bin.dat"))!)).toEqual([0, 1, 2, 255]);
  });
});
