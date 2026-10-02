"use client";

/**
 * The price bands for one product, with the dealer-specific ones alongside.
 *
 * Shown as an expanded row under the product it belongs to, so a rate is read
 * and changed in the same place as the product it applies to.
 *
 * Bands are listed general-first, then per dealer, in quantity order — the
 * order a price sheet is read in. Each row says which rate it is, because the
 * question an officer is actually asked at the counter is not "what is the
 * price" but "why is it that price".
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Plus, Trash2 } from "lucide-react";

import { apiFetch } from "@/lib/api/client";

export type PriceTier = {
  id: string;
  product_id: string;
  product_name: string | null;
  sku_code: string | null;
  dealer_id: string | null;
  dealer_name: string | null;
  min_quantity: number;
  max_quantity: number | null;
  price: string;
  band_label: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type DealerOption = { id: string; name: string };

type NewBand = {
  min_quantity: string;
  max_quantity: string;
  price: string;
  dealer_id: string;
  note: string;
};

const EMPTY_BAND: NewBand = {
  min_quantity: "",
  max_quantity: "",
  price: "",
  dealer_id: "",
  note: "",
};

const money = (value: string | number) =>
  `₹${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export default function PriceTierPanel({
  productId,
  listPrice,
  dealers,
}: {
  productId: string;
  listPrice: number;
  dealers: DealerOption[];
}) {
  const [tiers, setTiers] = useState<PriceTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<NewBand>(EMPTY_BAND);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    apiFetch<PriceTier[]>(`/admin/products/price-tiers?product_id=${productId}`)
      .then(setTiers)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load price bands.")
      )
      .finally(() => setLoading(false));
  }, [productId]);

  useEffect(load, [load]);

  const { general, byDealer } = useMemo(() => {
    const generalBands = tiers.filter((t) => t.dealer_id === null);
    const dealerBands = new Map<string, PriceTier[]>();
    tiers
      .filter((t) => t.dealer_id !== null)
      .forEach((t) => {
        const key = t.dealer_name || t.dealer_id || "Unknown dealer";
        dealerBands.set(key, [...(dealerBands.get(key) ?? []), t]);
      });
    return { general: generalBands, byDealer: dealerBands };
  }, [tiers]);

  const addBand = async () => {
    const min = Number(form.min_quantity);
    const price = Number(form.price);
    if (!Number.isInteger(min) || min < 1) {
      setFormError("The smallest quantity must be a whole number, 1 or more.");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setFormError("The price must be greater than zero.");
      return;
    }
    // Blank top means open-ended, which is null and not zero.
    let max: number | null = null;
    if (form.max_quantity.trim() !== "") {
      max = Number(form.max_quantity);
      if (!Number.isInteger(max) || max < min) {
        setFormError(
          "The largest quantity must be a whole number, and not less than the smallest. Leave it blank for an open-ended band."
        );
        return;
      }
    }

    setSaving(true);
    setFormError("");
    try {
      await apiFetch("/admin/products/price-tiers", {
        method: "POST",
        body: JSON.stringify({
          product_id: productId,
          min_quantity: min,
          max_quantity: max,
          price: String(price),
          dealer_id: form.dealer_id || null,
          note: form.note.trim() || null,
        }),
      });
      setForm(EMPTY_BAND);
      load();
    } catch (err) {
      // The server's message is the useful one here: it names the band that is
      // in the way. Don't replace it with something vaguer.
      setFormError(err instanceof Error ? err.message : "Could not save that band.");
    } finally {
      setSaving(false);
    }
  };

  const removeBand = async (tier: PriceTier) => {
    const who = tier.dealer_name ? ` for ${tier.dealer_name}` : "";
    if (
      !confirm(
        `Remove the ${tier.band_label} band${who} at ${money(tier.price)}? ` +
          `Orders already placed keep the price they were billed at. New orders in that quantity range will fall back to ` +
          `${tier.dealer_name ? "the general band, or " : ""}the list price of ${money(listPrice)}.`
      )
    ) {
      return;
    }
    try {
      await apiFetch(`/admin/products/price-tiers/${tier.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that band.");
    }
  };

  const bandRow = (tier: PriceTier) => (
    <tr key={tier.id} className="border-t border-slate-100">
      <td className="px-3 py-2 text-slate-700">{tier.band_label}</td>
      <td className="px-3 py-2 text-right font-medium text-slate-800">{money(tier.price)}</td>
      <td className="px-3 py-2 text-slate-500 text-xs">{tier.note || "—"}</td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={() => removeBand(tier)}
          className="text-red-400 hover:text-red-600"
          aria-label={`Remove the ${tier.band_label} band`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );

  return (
    <div className="bg-slate-50 border-t border-slate-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-slate-700">Price bands by quantity</h3>
        <span className="text-xs text-slate-500">
          List price {money(listPrice)} — charged for any quantity no band covers.
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2 mb-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-3">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading bands...
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-400 mb-1">
              All dealers
            </div>
            {general.length === 0 ? (
              <p className="text-sm text-slate-500">
                No quantity bands yet. Every quantity is charged the list price of{" "}
                {money(listPrice)}.
              </p>
            ) : (
              <table className="w-full text-sm bg-white border border-slate-200 rounded">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Quantity</th>
                    <th className="px-3 py-2 text-right font-semibold">Unit price</th>
                    <th className="px-3 py-2 text-left font-semibold">Note</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>{general.map(bandRow)}</tbody>
              </table>
            )}
          </div>

          {[...byDealer.entries()].map(([dealerName, bands]) => (
            <div key={dealerName}>
              <div className="text-xs font-semibold uppercase text-slate-400 mb-1">
                {dealerName} only
              </div>
              <table className="w-full text-sm bg-white border border-slate-200 rounded">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Quantity</th>
                    <th className="px-3 py-2 text-right font-semibold">Unit price</th>
                    <th className="px-3 py-2 text-left font-semibold">Note</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>{bands.map(bandRow)}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-slate-200">
        <div className="text-xs font-semibold uppercase text-slate-400 mb-2">Add a band</div>
        {formError && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2 mb-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{formError}</span>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <div>
            <label
              htmlFor={`min-${productId}`}
              className="text-xs font-semibold text-slate-500"
            >
              From qty
            </label>
            <input
              id={`min-${productId}`}
              type="number"
              min="1"
              step="1"
              value={form.min_quantity}
              onChange={(e) => setForm({ ...form, min_quantity: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-white text-slate-900"
            />
          </div>
          <div>
            <label
              htmlFor={`max-${productId}`}
              className="text-xs font-semibold text-slate-500"
            >
              To qty
            </label>
            <input
              id={`max-${productId}`}
              type="number"
              min="1"
              step="1"
              placeholder="blank = and above"
              value={form.max_quantity}
              onChange={(e) => setForm({ ...form, max_quantity: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-white text-slate-900 placeholder:text-slate-300"
            />
          </div>
          <div>
            <label
              htmlFor={`price-${productId}`}
              className="text-xs font-semibold text-slate-500"
            >
              Unit price
            </label>
            <input
              id={`price-${productId}`}
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-white text-slate-900"
            />
          </div>
          <div>
            <label
              htmlFor={`dealer-${productId}`}
              className="text-xs font-semibold text-slate-500"
            >
              Dealer
            </label>
            <select
              id={`dealer-${productId}`}
              value={form.dealer_id}
              onChange={(e) => setForm({ ...form, dealer_id: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-white text-slate-900"
            >
              <option value="">All dealers</option>
              {dealers.map((dealer) => (
                <option key={dealer.id} value={dealer.id}>
                  {dealer.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor={`note-${productId}`}
              className="text-xs font-semibold text-slate-500"
            >
              Note
            </label>
            <input
              id={`note-${productId}`}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-white text-slate-900"
            />
          </div>
          <button
            type="button"
            onClick={addBand}
            disabled={saving}
            className="flex items-center justify-center gap-1 px-3 py-1.5 bg-green-700 text-white rounded text-sm font-medium disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Add band
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Bands cannot overlap. A band set for one dealer beats the all-dealers band for
          the same quantities.
        </p>
      </div>
    </div>
  );
}
