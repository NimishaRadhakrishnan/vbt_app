"use client";

import React, { useState } from "react";
import { API_BASE_URL } from "@/lib/api/client";
import { tokenStorage } from "@/lib/api/token-storage";

// Speedometer photo + km, asked once at check-in and once at check-out.
export default function OdometerModal({
  kind, onDone, onCancel,
}: { kind: "check_in" | "check_out"; onDone: () => void; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [km, setKm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const morning = kind === "check_in";

  const submit = async () => {
    const value = parseFloat(km);
    if (!file) return setError("Take or choose a clear photo of the speedometer.");
    if (!isFinite(value) || value < 0) return setError("Enter the km shown on the speedometer.");
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("km", String(value));
      fd.append("file", file);
      const res = await fetch(`${API_BASE_URL}/odometer`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenStorage.getAccessToken()}` },
        body: fd,
      });
      if (!res.ok) {
        let msg = `Upload failed (${res.status}).`;
        try { const b = await res.json(); msg = b?.message ?? b?.detail ?? msg; } catch {}
        throw new Error(typeof msg === "string" ? msg : "Upload failed.");
      }
      onDone();
    } catch (e: any) {
      setError(e?.message || "Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-lg font-bold text-slate-900">{morning ? "Start of day: speedometer" : "End of day: speedometer"}</h3>
        <p className="text-sm text-slate-500">
          Upload a photo of the speedometer and type the km it shows.
          {morning ? " Needed before you check in." : " Needed before you check out (please do this before 6 PM)."}
        </p>
        {error && <div className="p-3 rounded-lg text-xs font-semibold bg-red-50 text-red-700 border border-red-200">{error}</div>}
        <input type="file" accept="image/jpeg,image/png" capture="environment"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm" />
        {file && <img src={URL.createObjectURL(file)} alt="Speedometer preview" className="w-full max-h-48 object-cover rounded-lg" />}
        <input type="number" inputMode="decimal" min="0" step="0.1" value={km} onChange={(e) => setKm(e.target.value)}
          placeholder="Km shown on speedometer"
          className="w-full text-sm p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-900" />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} disabled={busy} className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700">Cancel</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2 text-sm font-semibold rounded-lg bg-green-700 text-white disabled:opacity-60">
            {busy ? "Uploading…" : "Submit reading"}
          </button>
        </div>
      </div>
    </div>
  );
}
