// Professional, self-contained print view. Opens a clean window (no app
// chrome) with a letterhead, officer/date/time block, sectioned details,
// and a "Printed on" footer, then calls print().

export interface PrintSection {
  title: string;
  rows?: [string, any][];
  table?: { head: string[]; body: any[][] };
}

export interface PrintOptions {
  title: string;
  subtitle?: string;
  meta?: [string, any][];
  sections: PrintSection[];
}

const esc = (v: any) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
}

export function formatTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export function printReport(opts: PrintOptions) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) {
    alert("Please allow pop-ups to print.");
    return;
  }
  const printedOn = formatDateTime(new Date().toISOString());
  const meta = (opts.meta ?? []).filter(([, v]) => v !== null && v !== undefined && v !== "");
  const sections = opts.sections
    .map((s) => {
      const rows = (s.rows ?? []).filter(([, v]) => v !== null && v !== undefined && v !== "");
      if (!rows.length && !s.table?.body.length) return "";
      const rowsHtml = rows.length
        ? `<table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`
        : "";
      const tableHtml = s.table?.body.length
        ? `<table class="grid"><thead><tr>${s.table.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${s.table.body
            .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`
        : "";
      return `<section><h2>${esc(s.title)}</h2>${rowsHtml}${tableHtml}</section>`;
    })
    .join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
<style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;font-size:12px;margin:0}
header{border-bottom:3px solid #15803d;padding-bottom:8px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:flex-end}
header h1{margin:0;font-size:20px;color:#14532d}
header .brand{font-size:11px;color:#475569;text-align:right}
.sub{color:#475569;margin:0 0 10px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;margin-bottom:12px}
.meta div span{color:#64748b}
section{margin-bottom:12px;break-inside:avoid}
h2{font-size:13px;color:#15803d;border-bottom:1px solid #cbd5e1;padding-bottom:3px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em}
table{width:100%;border-collapse:collapse}
.kv th{width:32%;text-align:left;color:#64748b;font-weight:600;padding:3px 6px;vertical-align:top}
.kv td{padding:3px 6px;font-weight:600}
.kv tr:nth-child(even){background:#f8fafc}
.grid th,.grid td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left;vertical-align:top}
.grid th{background:#f1f5f9;font-size:11px}
tr{break-inside:avoid}
footer{position:fixed;bottom:0;left:0;right:0;border-top:1px solid #cbd5e1;padding-top:4px;font-size:10px;color:#64748b;display:flex;justify-content:space-between}
</style></head><body>
<header><div><h1>${esc(opts.title)}</h1></div><div class="brand"><b>VBT One</b><br>Vishakan Biotech</div></header>
${opts.subtitle ? `<p class="sub">${esc(opts.subtitle)}</p>` : ""}
${meta.length ? `<div class="meta">${meta.map(([k, v]) => `<div><span>${esc(k)}:</span> <b>${esc(v)}</b></div>`).join("")}</div>` : ""}
${sections}
<footer><span>Confidential — Vishakan Biotech</span><span>Printed on ${esc(printedOn)}</span></footer>
<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
</body></html>`);
  w.document.close();
}
