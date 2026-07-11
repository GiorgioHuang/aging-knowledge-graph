// Healthy Aging Knowledge — document fetch + text extraction.
// Turns a guideline URL into clean plain text, whether it's a PDF (WHO/CDC/
// Canadian guidelines are overwhelmingly PDFs) or an HTML page. The heavy deps
// (unpdf for PDF, linkedom + @mozilla/readability for article extraction) are
// LAZY-IMPORTED inside the functions, so any code path that never fetches a
// document — offline search, the test suite — pays nothing for them.
import { stripTags } from "./sources.ts";

export interface FetchedDoc { text: string; kind: "pdf" | "html"; chars: number }

/** Extract text from a PDF's bytes via pdf.js (through unpdf). */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  const joined = Array.isArray(text) ? text.join("\n") : (text ?? "");
  return joined.replace(/\s+/g, " ").trim();
}

/** Extract the readable article text from an HTML page. Uses Readability to
 *  drop nav/menus/boilerplate; falls back to a plain tag-strip if that yields
 *  too little (some guideline pages aren't article-shaped). Pure — no network,
 *  so it's unit-testable with an HTML fixture. */
export async function htmlToText(html: string): Promise<string> {
  try {
    const { parseHTML } = await import("linkedom");
    const { Readability } = await import("@mozilla/readability");
    const { document } = parseHTML(html);
    const art = new Readability(document as unknown as Document).parse();
    const t = (art?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (t.length >= 200) return t;
  } catch {
    /* readability can throw on malformed markup — fall through to tag-strip */
  }
  return stripTags(html.replace(/<(script|style|noscript|head)[\s\S]*?<\/\1>/gi, " "));
}

/** Fetch a URL and return clean text. PDF vs HTML is decided by the response
 *  content-type (falling back to a .pdf path check). Throws on a bad response. */
export async function fetchDocument(url: string, ms = 30000): Promise<FetchedDoc> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "HealthyAgingKnowledge/1.0 (https://ack.icareu.ca)" } });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    const isPdf = ctype.includes("pdf") || /\.pdf(\?|#|$)/i.test(url);
    if (isPdf) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const text = await pdfToText(bytes);
      return { text, kind: "pdf", chars: text.length };
    }
    const text = await htmlToText(await res.text());
    return { text, kind: "html", chars: text.length };
  } finally {
    clearTimeout(timer);
  }
}
