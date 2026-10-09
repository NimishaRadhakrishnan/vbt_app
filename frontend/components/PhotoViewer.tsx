"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { tokenStorage } from "@/lib/api/token-storage";

// Uploaded photos are served from GET /files/{name}, which needs ?token=...
// because an <img> tag cannot send an Authorization header.
export function withFileToken(url: string): string {
  const token = tokenStorage.getAccessToken();
  if (!token || !url) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

/** A row of photo thumbnails; clicking one opens a full-size viewer with
 *  Back / Next / Close (also the arrow keys and Escape). */
export default function PhotoGallery({ urls }: { urls: string[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const count = urls.length;

  const go = useCallback(
    (delta: number) => setOpen((i) => (i === null ? i : (i + delta + count) % count)),
    [count],
  );

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        {urls.map((u, i) => (
          <button key={i} type="button" onClick={() => setOpen(i)} className="focus:outline-none">
            <img
              src={withFileToken(u)}
              alt={`Photo ${i + 1}`}
              className="w-24 h-24 object-cover rounded border border-slate-200 hover:opacity-80"
            />
          </button>
        ))}
      </div>

      {open !== null && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
          onClick={() => setOpen(null)}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(null)}
            className="absolute top-4 right-4 text-white bg-white/10 hover:bg-white/20 rounded-full p-2"
          >
            <X size={22} />
          </button>
          {count > 1 && (
            <button
              type="button"
              aria-label="Previous photo"
              onClick={(e) => { e.stopPropagation(); go(-1); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white bg-white/10 hover:bg-white/20 rounded-full p-3"
            >
              <ChevronLeft size={28} />
            </button>
          )}
          <img
            src={withFileToken(urls[open] ?? "")}
            alt={`Photo ${open + 1} of ${count}`}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] max-w-[88vw] object-contain rounded"
          />
          {count > 1 && (
            <button
              type="button"
              aria-label="Next photo"
              onClick={(e) => { e.stopPropagation(); go(1); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white bg-white/10 hover:bg-white/20 rounded-full p-3"
            >
              <ChevronRight size={28} />
            </button>
          )}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm bg-white/10 rounded-full px-3 py-1">
            {open + 1} / {count}
          </div>
        </div>
      )}
    </>
  );
}
