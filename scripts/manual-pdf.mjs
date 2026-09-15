#!/usr/bin/env node
/**
 * Prints the documents in docs/manual/ to the A5 PDFs in docs/.
 *
 *   node scripts/manual-pdf.mjs                    # every document, light and dark
 *   node scripts/manual-pdf.mjs code-tour          # just that one
 *   node scripts/manual-pdf.mjs code-tour --light  # just its light copy
 *
 * Drives a headless Chromium over the DevTools protocol: the manual's print
 * styles (@page A5, the running page number) do the layout, so this only has
 * to say "print the backgrounds and believe the CSS page size".
 *
 * Two passes. The first one produces a PDF nobody keeps: pdftotext reads it to
 * learn which page each chapter landed on, those numbers are written into the
 * empty slots in the Contents, and the second pass is the one that ships.
 *
 * Chromium comes from the Playwright cache (CHROME_BIN overrides).
 */

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 9333;

/** Source in docs/manual/, name of the pair of PDFs it produces in docs/. */
const DOCS = {
  "field-manual": "Love Button Field Manual",
  "code-tour": "Love Button Code Tour",
};

/* Titles repeat inside the text ("The server" is also a row in a chapter 1
   table), so the first pass is marked instead of searched: a short invisible tag
   goes on each chapter's and each step's own line, and the page it prints on is
   that section's page. Transparent, and short enough not to rewrap the line it
   joins, so the marked run paginates exactly like the shipped one. */
const MARK = (id) => "ZZ" + id.toUpperCase() + "ZZ";
const MARK_JS = `(() => {
  const ids = [];
  for (const sec of document.querySelectorAll("section.ch, article.step")) {
    if (!sec.id) continue;
    const line = sec.querySelector(".eyebrow, .step-no") || sec.querySelector("h2, h3");
    if (!line) continue;
    const tag = document.createElement("span");
    tag.style.color = "transparent";
    tag.textContent = " ZZ" + sec.id.toUpperCase() + "ZZ";
    line.appendChild(tag);
    ids.push(sec.id);
  }
  return ids.join(",");
})()`;

/* Dark reading copy: the palette is all custom properties, so swapping the
   tokens is the whole job — except where ink sits on a pastel fill (the
   diagram boxes, the trace pills), which stay dark-on-light on a light card. */
const DARK_CSS = `
:root{
  --ground:#17121A; --surface:#241D28; --wash:#2E2333;
  --ink:#F6EDF3; --ink-2:#CBB9C5; --ink-3:#9F8C9A;
  --rule:#3A2E3F; --rule-2:#4E3F54;
  --crimson:#FF7FB0; --rose:#FF9EC2; --code-bg:#241D28;
}
html,body{background:#17121A}
figure.dia .sv{background:#FFF7FA;border-radius:12px;padding:10px 8px}
figure.dia svg{color:#2E2430}
.who{color:#2E2430}
.why li::before{outline-color:#17121A}
pre{border-color:var(--rule-2)}
@media print{
  /* The paper is the colour of the page, so the @page margin box would print
     white. Zero the margins, inset with padding instead — the running page
     number lives in that margin box and goes with it. */
  :root{--ground:#17121A}
  @page{margin:0}
  @page :first{margin:0}
  body{padding:12mm 11mm 14mm}
  .cover{height:156mm}
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const cache = join(process.env.HOME, ".cache/ms-playwright");
  const dir = readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().pop();
  if (!dir) throw new Error("no Chromium in ~/.cache/ms-playwright — set CHROME_BIN");
  return join(cache, dir, "chrome-linux64/chrome");
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = []; }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error("cdp connect failed")); });
    const c = new Cdp(ws);
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && c.waiting.has(msg.id)) {
        const { ok, no } = c.waiting.get(msg.id);
        c.waiting.delete(msg.id);
        msg.error ? no(new Error(msg.error.message)) : ok(msg.result);
      } else if (msg.method) c.events.push(msg.method);
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, no) => this.waiting.set(id, { ok, no }));
  }
  async waitForEvent(method, timeoutMs = 30000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (this.events.includes(method)) return;
      await sleep(50);
    }
    throw new Error(`timed out waiting for ${method}`);
  }
}

async function render({ source, dark, mark, pageNumbers, out }) {
  const page = await Cdp.open(await newTab());
  let marked = [];
  await page.send("Page.enable");
  await page.send("Emulation.setEmulatedMedia", { media: "print" });
  await page.send("Page.navigate", { url: "file://" + source });
  await page.waitForEvent("Page.loadEventFired");
  await page.send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
  await sleep(600); // the webfonts land after ready on a cold cache

  if (mark) {
    const { result } = await page.send("Runtime.evaluate", { expression: MARK_JS });
    marked = String(result.value ?? "").split(",").filter(Boolean);
  }
  if (dark) {
    await page.send("Runtime.evaluate", {
      expression: `(() => { const s = document.createElement("style");
        s.textContent = ${JSON.stringify(DARK_CSS)}; document.head.appendChild(s); })()`,
    });
  }
  if (pageNumbers) {
    await page.send("Runtime.evaluate", {
      expression: `(() => { const n = ${JSON.stringify(pageNumbers)};
        for (const id in n) { const el = document.querySelector('.pg[data-for=' + id + ']');
          if (el) el.textContent = n[id]; } })()`,
    });
  }
  await sleep(200);

  const { data } = await page.send("Page.printToPDF", {
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
  });
  writeFileSync(out, Buffer.from(data, "base64"));
  page.ws.close();
  return marked;
}

async function newTab() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" });
  return (await res.json()).webSocketDebuggerUrl;
}

/** Which page did each marked section start on? Read it back out of the PDF. */
function pageNumbersFrom(pdf, ids) {
  let text;
  try {
    text = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 64e6 });
  } catch {
    console.warn("! pdftotext missing — the Contents will have no page numbers");
    return null;
  }
  const pages = text.split("\f");
  const found = {};
  for (const id of ids) {
    const at = pages.findIndex((p) => p.includes(MARK(id)));
    if (at >= 0) found[id] = String(at + 1);
  }
  return found;
}

const args = process.argv.slice(2);
const only = args.includes("--light") ? "light" : args.includes("--dark") ? "dark" : "both";

const named = args.filter((a) => !a.startsWith("--"));
for (const name of named) {
  if (!DOCS[name]) throw new Error(`unknown document "${name}" — one of: ${Object.keys(DOCS).join(", ")}`);
}
const docs = (named.length ? named : Object.keys(DOCS)).map((name) => ({
  name,
  source: join(ROOT, `docs/manual/${name}.html`),
  light: join(ROOT, `docs/${DOCS[name]}.pdf`),
  dark: join(ROOT, `docs/${DOCS[name]}_dark.pdf`),
}));

const profile = mkdtempSync(join(tmpdir(), "manual-pdf-"));
const chrome = spawn(findChrome(), [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  "--disable-dev-shm-usage", "--font-render-hinting=none",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

try {
  for (let i = 0; ; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; }
    catch { if (i > 100) throw new Error("Chromium never opened its debugging port"); await sleep(100); }
  }

  /* The dark copy insets with padding instead of page margins, so it
     paginates differently — each variant measures itself. */
  for (const doc of docs) {
    for (const variant of ["light", "dark"]) {
      if (only !== "both" && only !== variant) continue;
      const dark = variant === "dark";
      const scratch = join(profile, `pass1-${doc.name}-${variant}.pdf`);
      const ids = await render({ source: doc.source, dark, mark: true, pageNumbers: null, out: scratch });
      const numbers = pageNumbersFrom(scratch, ids);
      await render({ source: doc.source, dark, mark: false, pageNumbers: numbers, out: doc[variant] });
      console.log("wrote", doc[variant], numbers ? `(${Object.keys(numbers).length} sections numbered)` : "(no page numbers)");
    }
  }
} finally {
  chrome.kill();
  await sleep(300); // Chromium is still writing its profile as it goes down
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}
