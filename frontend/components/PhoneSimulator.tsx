"use client";

import React, { useState, useEffect } from "react";
import { X, RotateCw } from "lucide-react";

// Device simulator: renders the CURRENT page inside a phone-sized iframe
// frame, purely as a preview overlay - the real page behind it is
// completely untouched (no layout changes, no responsive breakpoint
// forced). Needs X-Frame-Options: SAMEORIGIN (see next.config.js) since
// this is the app iframing itself; that header change still fully blocks
// the actual clickjacking threat (an external site framing this app),
// it just also permits same-origin framing like this.
//
// The iframe loads `window.location.href` fresh, i.e. it's a genuinely
// separate document/React tree from the real page, not a visual
// transform of it - navigating inside the frame (tapping a link) moves
// the simulator to that page without touching the actual browser tab.
//
// Real bug fixed here: the close button used to be positioned directly
// above the phone bezel as one centered block, with no fallback if that
// block (which can be 800+px tall for some device presets) was taller
// than the visible viewport - a short browser window (tab strip +
// toolbar eating vertical space) could push the close button above the
// visible area entirely, with no scroll, no backdrop-click-to-dismiss,
// and no Escape handler to get back out. Four independent fixes now,
// not just one, so no single one being insufficient traps someone
// again: (1) the close button is fixed to the viewport's own top-right
// corner, independent of the phone bezel's height or the centered
// content's own size, (2) clicking the backdrop closes it, (3) Escape
// closes it, (4) the whole overlay scrolls if content still doesn't fit.
const DEVICE_PRESETS = [
  { name: "iPhone 14", width: 390, height: 844 },
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "Pixel 7", width: 412, height: 915 },
];

export default function PhoneSimulator({ onClose }: { onClose: () => void }) {
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const device = DEVICE_PRESETS[deviceIndex] || { name: "iPhone 14", width: 390, height: 844 };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto bg-black/50"
      onClick={(e) => {
        // Closes only when the click lands directly on this backdrop
        // element itself, not on anything nested inside it - a click on
        // the control bar or phone bezel still bubbles up to here, but
        // e.target won't equal e.currentTarget for those, so this
        // check alone is enough without needing stopPropagation()
        // anywhere in the tree below.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Always reachable regardless of viewport size or device preset
          height - fixed to the overlay's own corner, not stacked above
          content that might not fit. This is the actual fix; everything
          else here is a secondary safety net. */}
      <button
        onClick={onClose}
        className="fixed top-4 right-4 z-[101] p-2 bg-white rounded-full shadow-lg text-slate-500 hover:text-slate-800"
        title="Close preview (Esc)"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="min-h-full flex items-center justify-center p-4 py-16" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 bg-white rounded-full shadow-lg px-3 py-1.5">
            <select
              value={deviceIndex}
              onChange={(e) => setDeviceIndex(Number(e.target.value))}
              className="text-xs font-semibold text-slate-700 bg-transparent focus:outline-none"
            >
              {DEVICE_PRESETS.map((d, i) => (
                <option key={d.name} value={i}>{d.name} ({d.width}×{d.height})</option>
              ))}
            </select>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="p-1 text-slate-400 hover:text-slate-700"
              title="Reload preview"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Phone bezel - purely decorative framing around the iframe */}
          <div
            className="bg-slate-900 rounded-[2.5rem] p-3 shadow-2xl flex-shrink-0"
            style={{ width: device.width + 24, height: device.height + 24 }}
          >
            <div className="relative w-full h-full bg-white rounded-[1.75rem] overflow-hidden">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-slate-900 rounded-b-xl z-10" />
              <iframe
                key={reloadKey}
                src={typeof window !== "undefined" ? window.location.href : ""}
                title="Phone preview"
                className="w-full h-full border-0"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
