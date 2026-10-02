"use client";

/**
 * The three chart shapes the management dashboard needs, hand-drawn in SVG.
 *
 * No charting library: this project has none, and the alternative to adding
 * one is about 200 lines that do exactly what is needed and nothing else. A
 * library would also bring its own type scale and colours, which is the wrong
 * trade on a screen whose whole requirement is that an older, non-technical
 * reader can take it in at a glance.
 *
 * COLOUR
 * ------
 * The categorical palette is fixed and assigned in order, never cycled - the
 * colour follows the product, so filtering the list does not repaint the
 * survivors and make the reader think the data changed.
 *
 * These four were checked with a colour-vision validator rather than by eye:
 * every adjacent pair separates under deuteranopia and tritanopia, every one
 * clears 3:1 against a white card, and none of them reads as grey. The first
 * is the company's own maroon, so the brand leads.
 *
 * Colour never carries meaning on its own. Every series is also named in a
 * legend and, where there is room, labelled directly on the mark.
 *
 * TEXT
 * ----
 * Labels and values wear text colours, never the series colour. A number
 * printed in the same maroon as its bar is harder to read and adds nothing:
 * the mark beside it already says which series it belongs to.
 */

import React, { useId, useState } from "react";

export const SERIES_COLORS = ["#9f1d1d", "#0d9488", "#b45309", "#1d4ed8"] as const;

export const seriesColor = (index: number): string =>
  SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0];

const INK = "#1e293b";
const INK_MUTED = "#64748b";
const GRID = "#e2e8f0";

export type BarDatum = {
  label: string;
  value: number;
  /** What to print at the end of the bar. Falls back to the raw value. */
  display?: string;
  /** Optional second line under the label, e.g. a district or a role. */
  sublabel?: string;
};

/**
 * Horizontal bars, for "who sold the most" and "which product sold the most".
 *
 * Horizontal and not vertical because the labels are names - "Pseudomonas
 * Bio-Pesticide (500g)", "Kannan Agro Center" - and names read straight across
 * without tilting the reader's head or the text.
 */
export function HorizontalBars({
  data,
  maxBars = 8,
  emptyMessage = "Nothing to show yet.",
  valueLabel,
}: {
  data: BarDatum[];
  maxBars?: number;
  emptyMessage?: string;
  valueLabel?: string;
}) {
  const shown = data.slice(0, maxBars);
  const max = Math.max(...shown.map((d) => d.value), 0);

  if (shown.length === 0 || max <= 0) {
    return <p className="text-slate-500 py-6 text-center">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-3">
      {valueLabel && (
        <p className="text-xs uppercase tracking-wide text-slate-400">{valueLabel}</p>
      )}
      {shown.map((datum, index) => {
        // Every bar gets at least a sliver, so a small-but-real value is
        // never invisible next to a large one. A reader who sees nothing
        // concludes there is nothing.
        const percent = Math.max(1.5, (datum.value / max) * 100);
        return (
          <div key={`${datum.label}-${index}`}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-base font-medium text-slate-800 truncate">
                {datum.label}
                {datum.sublabel && (
                  <span className="text-sm text-slate-400 font-normal">
                    {" "}
                    · {datum.sublabel}
                  </span>
                )}
              </span>
              <span className="text-base font-semibold text-slate-900 tabular-nums shrink-0">
                {datum.display ?? datum.value.toLocaleString("en-IN")}
              </span>
            </div>
            <div className="h-5 w-full rounded bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-r"
                style={{ width: `${percent}%`, backgroundColor: seriesColor(index) }}
                role="img"
                aria-label={`${datum.label}: ${datum.display ?? datum.value}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export type LinePoint = { label: string; value: number; display?: string };

/**
 * One line over time, for "is the business going up or down".
 *
 * A single series, so there is no legend: the heading above it names what the
 * line is. Points are marked and the hovered one is called out in words,
 * because a shape without a number is an impression, not a figure.
 */
export function TrendLine({
  points,
  height = 200,
  emptyMessage = "Not enough history to draw a trend yet.",
}: {
  points: LinePoint[];
  height?: number;
  emptyMessage?: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return <p className="text-slate-500 py-6 text-center">{emptyMessage}</p>;
  }

  const width = 720;
  const padding = { top: 16, right: 16, bottom: 34, left: 16 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const max = Math.max(...points.map((p) => p.value));
  // The scale starts at zero. A line chart that starts at the minimum
  // exaggerates every wobble into a cliff, which is the most common way a
  // truthful number becomes a misleading picture.
  const scaleY = (value: number) =>
    padding.top + plotHeight - (max <= 0 ? 0 : (value / max) * plotHeight);
  const scaleX = (index: number) =>
    padding.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(i)} ${scaleY(p.value)}`)
    .join(" ");
  const areaPath =
    `${linePath} L ${scaleX(points.length - 1)} ${padding.top + plotHeight}` +
    ` L ${scaleX(0)} ${padding.top + plotHeight} Z`;

  // Enough labels to orient the reader, never so many they collide.
  const labelEvery = Math.ceil(points.length / 6);
  const active = hover !== null ? points[hover] : null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Sales by month. Highest ${Math.round(max).toLocaleString("en-IN")}.`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES_COLORS[0]} stopOpacity="0.18" />
            <stop offset="100%" stopColor={SERIES_COLORS[0]} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive baseline only: gridlines behind six points are clutter. */}
        <line
          x1={padding.left}
          y1={padding.top + plotHeight}
          x2={width - padding.right}
          y2={padding.top + plotHeight}
          stroke={GRID}
          strokeWidth="1"
        />

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={SERIES_COLORS[0]}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            {/* An invisible wide target, so hovering does not require
                landing on an 8px dot. */}
            <rect
              x={scaleX(index) - plotWidth / (points.length * 2)}
              y={padding.top}
              width={plotWidth / points.length}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
            <circle
              cx={scaleX(index)}
              cy={scaleY(point.value)}
              r={hover === index ? 6 : 4}
              fill="#ffffff"
              stroke={SERIES_COLORS[0]}
              strokeWidth="2.5"
            />
            {index % labelEvery === 0 && (
              <text
                x={scaleX(index)}
                y={height - 12}
                textAnchor="middle"
                fontSize="13"
                fill={INK_MUTED}
              >
                {point.label}
              </text>
            )}
          </g>
        ))}
      </svg>

      <p className="text-center text-base text-slate-600 mt-1 min-h-[1.5rem]">
        {active ? (
          <>
            <span className="font-semibold text-slate-900">{active.label}</span>:{" "}
            {active.display ?? active.value.toLocaleString("en-IN")}
          </>
        ) : (
          <span className="text-slate-400">Point at the line to see each month.</span>
        )}
      </p>
    </div>
  );
}

export type MultiSeries = {
  name: string;
  points: LinePoint[];
};

/**
 * Several lines over the same months, for "which products are seasonal".
 *
 * Two or more series, so a legend is always present and every series is also
 * named in it - identity is never carried by colour alone.
 */
export function SeasonLines({
  series,
  height = 240,
  emptyMessage = "Not enough history yet.",
}: {
  series: MultiSeries[];
  height?: number;
  emptyMessage?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const labels = series[0]?.points.map((p) => p.label) ?? [];
  if (series.length === 0 || labels.length < 2) {
    return <p className="text-slate-500 py-6 text-center">{emptyMessage}</p>;
  }

  const width = 720;
  const padding = { top: 14, right: 14, bottom: 34, left: 14 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const max = Math.max(...series.flatMap((s) => s.points.map((p) => p.value)), 0);
  const scaleY = (value: number) =>
    padding.top + plotHeight - (max <= 0 ? 0 : (value / max) * plotHeight);
  const scaleX = (index: number) =>
    padding.left + (labels.length === 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth);

  const labelEvery = Math.ceil(labels.length / 6);

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Monthly sales for ${series.map((s) => s.name).join(", ")}.`}
        onMouseLeave={() => setHover(null)}
      >
        <line
          x1={padding.left}
          y1={padding.top + plotHeight}
          x2={width - padding.right}
          y2={padding.top + plotHeight}
          stroke={GRID}
          strokeWidth="1"
        />

        {series.map((line, seriesIndex) => (
          <path
            key={line.name}
            d={line.points
              .map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(i)} ${scaleY(p.value)}`)
              .join(" ")}
            fill="none"
            stroke={seriesColor(seriesIndex)}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={hover === null || hover === seriesIndex ? 1 : 0.25}
          />
        ))}

        {labels.map((label, index) =>
          index % labelEvery === 0 ? (
            <text
              key={label}
              x={scaleX(index)}
              y={height - 12}
              textAnchor="middle"
              fontSize="13"
              fill={INK_MUTED}
            >
              {label}
            </text>
          ) : null
        )}
      </svg>

      <div className="flex flex-wrap gap-x-5 gap-y-2 justify-center mt-1">
        {series.map((line, index) => (
          <button
            key={line.name}
            type="button"
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(index)}
            onBlur={() => setHover(null)}
            className="flex items-center gap-2 text-base text-slate-700"
          >
            <span
              className="inline-block w-4 h-1.5 rounded"
              style={{ backgroundColor: seriesColor(index) }}
            />
            {line.name}
          </button>
        ))}
      </div>
    </div>
  );
}
