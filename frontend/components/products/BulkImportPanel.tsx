"use client";

/**
 * Bulk entry for products, and for price bands, as two separate sheets.
 *
 * Two sheets rather than one wide one, because they are filled in at different
 * times by different people: the catalog is set up once, and the price sheet is
 * revised whenever rates move. A combined sheet would mean retyping every
 * product's name, category and SKU to change one rate.
 *
 * Preview before save, always. The Check button runs the same validation the
 * save would run but writes nothing, so the operator sees every problem at
 * once, against the row number in their spreadsheet. The backend rejects a
 * batch whole if any row fails: half an applied price sheet is worse than none,
 * because nobody can tell which products are now wrong and the dealer finds out
 * first.
 */

import React, { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ClipboardPaste, Loader2, Upload } from "lucide-react";

import { apiFetch } from "@/lib/api/client";
import { parseCsvToObjects } from "@/lib/csv";

type Mode = "products" | "tiers";

type RowError = { row_number: number; error: string };

type ImportResult = {
  applied: number;
  rejected: number;
  errors: RowError[];
  dry_run: boolean;
  would_apply?: number | null;
  message: string;
};

const TEMPLATES: Record<Mode, { columns: string; example: string; hint: string }> = {
  products: {
    columns: "name,category,sku_code,price,description",
    example: [
      "name,category,sku_code,price,description",
      "Bio-NPK Liquid,Bio-fertiliser,VBT-BNPK-1L,450,1 litre bottle",
      "Neem Oil Concentrate,Bio-pesticide,VBT-NEEM-500,320,500 ml",
    ].join("\n"),
    hint: "One row per product. This is the list price — quantity bands are set on the other sheet.",
  },
  tiers: {
    columns: "sku_code,min_quantity,max_quantity,price,dealer_phone,note",
    example: [
      "sku_code,min_quantity,max_quantity,price,dealer_phone,note",
      "VBT-BNPK-1L,1,10,450,,",
      "VBT-BNPK-1L,11,50,420,,",
      "VBT-BNPK-1L,51,,400,,51 and above",
      "VBT-BNPK-1L,1,10,430,9876543210,Kannan Agro special",
    ].join("\n"),
    hint: "Leave max_quantity blank for an open-ended band (\"51 and above\"). Leave dealer_phone blank for a rate that applies to every dealer; fill it in to price one dealer differently for the same quantities.",
  },
};

/** Empty string -> undefined, so a blank cell means "not given" and not 0 or "". */
function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

export default function BulkImportPanel({
  onImported,
}: {
  onImported: () => void;
}) {
  const [mode, setMode] = useState<Mode>("products");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"check" | "save" | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState("");

  const template = TEMPLATES[mode];

  const parsed = useMemo(() => {
    if (!text.trim()) return { header: [] as string[], records: [] as Record<string, string>[] };
    return parseCsvToObjects(text);
  }, [text]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setResult(null);
    setParseError("");
  };

  /** Build the request rows, or throw with a message naming the missing column. */
  const buildRows = (): Record<string, unknown>[] => {
    const { header, records } = parsed;
    if (records.length === 0) {
      throw new Error("Nothing to import — paste your rows above, including the header line.");
    }

    const required =
      mode === "products"
        ? ["name", "category", "sku_code", "price"]
        : ["min_quantity", "price"];
    const missing = required.filter((column) => !header.includes(column));
    if (missing.length > 0) {
      throw new Error(
        `The header line is missing: ${missing.join(", ")}. Expected columns are ${template.columns}.`
      );
    }
    if (mode === "tiers" && !header.includes("sku_code") && !header.includes("product_id")) {
      throw new Error(
        "Price bands need a sku_code column (or product_id) so each row can be matched to a product."
      );
    }

    // row_number is the operator's own line number, counting the header as
    // line 1, so an error points at the row they can see in their spreadsheet.
    return records.map((record, index) => {
      const rowNumber = index + 2;
      if (mode === "products") {
        return {
          row_number: rowNumber,
          name: record.name ?? "",
          category: record.category ?? "",
          sku_code: record.sku_code ?? "",
          price: blankToUndefined(record.price) ?? "0",
          description: blankToUndefined(record.description),
        };
      }
      return {
        row_number: rowNumber,
        sku_code: blankToUndefined(record.sku_code),
        product_id: blankToUndefined(record.product_id),
        dealer_phone: blankToUndefined(record.dealer_phone),
        min_quantity: Number(blankToUndefined(record.min_quantity) ?? 0),
        // Blank means open-ended, which is null and not zero.
        max_quantity:
          blankToUndefined(record.max_quantity) === undefined
            ? null
            : Number(record.max_quantity),
        price: blankToUndefined(record.price) ?? "0",
        note: blankToUndefined(record.note),
      };
    });
  };

  const submit = async (dryRun: boolean) => {
    setParseError("");
    setResult(null);
    let rows: Record<string, unknown>[];
    try {
      rows = buildRows();
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Could not read those rows.");
      return;
    }

    setBusy(dryRun ? "check" : "save");
    try {
      const path =
        mode === "products" ? "/admin/products/bulk" : "/admin/products/price-tiers/bulk";
      const response = await apiFetch<ImportResult>(path, {
        method: "POST",
        body: JSON.stringify({ rows, dry_run: dryRun }),
      });
      setResult(response);
      if (!dryRun && response.applied > 0) {
        setText("");
        onImported();
      }
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : "The import could not be sent. Try again."
      );
    } finally {
      setBusy(null);
    }
  };

  const rowCount = parsed.records.length;
  const checked = result?.dry_run === true && result.rejected === 0;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => switchMode("products")}
            className={`px-3 py-1.5 text-sm font-medium ${
              mode === "products"
                ? "bg-primary-700 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            Products
          </button>
          <button
            type="button"
            onClick={() => switchMode("tiers")}
            className={`px-3 py-1.5 text-sm font-medium border-l border-slate-200 ${
              mode === "tiers"
                ? "bg-primary-700 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            Price bands
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setText(template.example);
            setResult(null);
            setParseError("");
          }}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
        >
          <ClipboardPaste className="w-4 h-4" /> Fill in an example
        </button>
      </div>

      <p className="text-xs text-slate-500 mb-2">{template.hint}</p>

      <label htmlFor="bulk-import-rows" className="text-xs font-semibold text-slate-500">
        Paste rows (copy straight out of Excel, or type comma-separated)
      </label>
      <textarea
        id="bulk-import-rows"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
        }}
        rows={8}
        spellCheck={false}
        placeholder={template.columns}
        className="w-full mt-1 px-3 py-2 border border-slate-200 rounded font-mono text-xs bg-slate-50 text-slate-900 resize-y"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
        <span className="text-xs text-slate-500">
          {rowCount === 0
            ? "No rows read yet."
            : `${rowCount} row${rowCount === 1 ? "" : "s"} read, plus the header line.`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={busy !== null || rowCount === 0}
            className="flex items-center gap-1 px-4 py-1.5 border border-slate-300 text-slate-700 rounded text-sm font-medium disabled:opacity-50"
          >
            {busy === "check" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Check without saving
          </button>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={busy !== null || rowCount === 0}
            className="flex items-center gap-1 px-4 py-1.5 bg-green-700 text-white rounded text-sm font-medium disabled:opacity-50"
          >
            {busy === "save" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {checked ? `Save ${rowCount} rows` : "Save"}
          </button>
        </div>
      </div>

      {parseError && (
        <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{parseError}</span>
        </div>
      )}

      {result && (
        <div
          // success-* and not green-*: in this theme "green" is the maroon
          // brand palette, so a green-50 banner is the same pink as the error
          // one and the operator cannot tell saved from rejected at a glance.
          className={`mt-3 rounded border p-3 text-sm ${
            result.rejected > 0
              ? "bg-red-50 border-red-200 text-red-700"
              : "bg-success-50 border-success-200 text-success-800"
          }`}
        >
          <div className="flex items-start gap-2">
            {result.rejected > 0 ? (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span className="font-medium">{result.message}</span>
          </div>

          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {result.errors.map((rowError) => (
                <li key={rowError.row_number} className="flex gap-2">
                  <span className="font-mono shrink-0">Row {rowError.row_number}</span>
                  <span>{rowError.error}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
