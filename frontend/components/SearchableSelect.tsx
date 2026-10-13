"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

export type SearchableOption = { value: string; label: string };

/**
 * A dropdown you can type into. Built for long lists (hundreds of
 * products) where scrolling a native <select> is slow. Typing filters on
 * every word, in any order: "nitro 5" finds "V-NITRO (Liquid 5 Lit)".
 *
 * Carries a hidden required input so a form with `required` still refuses
 * to submit until something is picked, like the select it replaces.
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "-- Choose --",
  required = false,
  className = "",
  focusRing = "focus:ring-green-600",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  required?: boolean;
  className?: string;
  focusRing?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    return options.filter((o) => {
      const text = o.label.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [options, query]);

  useEffect(() => setActive(0), [query, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open) { e.preventDefault(); const o = shown[active]; if (o) pick(o.value); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        type="text"
        value={open ? query : selected?.label ?? ""}
        placeholder={open && selected ? selected.label : placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        className={`w-full text-sm p-2.5 rounded-lg border border-slate-200 bg-slate-50 font-medium focus:outline-none focus:ring-2 ${focusRing} text-slate-900`}
      />
      {/* Keeps native "required" working: empty until something is picked. */}
      {required && (
        <input tabIndex={-1} aria-hidden className="absolute opacity-0 h-0 w-0 pointer-events-none" required value={value} onChange={() => {}} />
      )}
      {open && (
        <ul className="absolute z-30 mt-1 w-full max-h-64 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg text-sm">
          {shown.length === 0 && <li className="px-3 py-2 text-slate-400">No match</li>}
          {shown.map((o, i) => (
            <li
              key={o.value}
              onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-2 cursor-pointer ${i === active ? "bg-green-50" : ""} ${o.value === value ? "font-semibold" : ""}`}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
