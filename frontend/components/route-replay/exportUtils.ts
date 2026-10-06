import type { Analysis } from "./types";
import { fmtDistance, fmtDuration, fmtTime } from "./format";

function cell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Two sections in one CSV (opens directly in Excel): the day's timeline,
 * then the raw cleaned GPS points.
 */
export function buildCsv(a: Analysis, officerName: string, date: string): string {
  const lines: string[] = [];
  lines.push(`Route report,${cell(officerName)},${date}`);
  lines.push(
    `Distance,${cell(fmtDistance(a.summary.distanceM))},Stops,${a.summary.stopsCount},Moving,${cell(fmtDuration(a.summary.movingMs))},Stationary,${cell(fmtDuration(a.summary.stationaryMs))},No signal,${cell(fmtDuration(a.summary.noSignalMs))}`,
  );
  lines.push("");
  lines.push("Timeline");
  lines.push("Type,From,To,Duration,Place,Distance,Latitude,Longitude");
  for (const e of a.events) {
    switch (e.kind) {
      case "start":
        lines.push(`Day started,${fmtTime(e.at)},,,,,${a.points[e.idx]?.lat ?? ""},${a.points[e.idx]?.lng ?? ""}`);
        break;
      case "end":
        lines.push(`Day ended,${fmtTime(e.at)},,,,,${a.points[e.idx]?.lat ?? ""},${a.points[e.idx]?.lng ?? ""}`);
        break;
      case "stop":
        lines.push(
          [
            `Stop ${e.stop.number}`,
            fmtTime(e.stop.arrival),
            fmtTime(e.stop.departure),
            fmtDuration(e.stop.dwellMs),
            e.stop.placeName ?? "Unknown location",
            "",
            e.stop.lat.toFixed(6),
            e.stop.lng.toFixed(6),
          ]
            .map(cell)
            .join(","),
        );
        break;
      case "travel":
        lines.push(["Travel", fmtTime(e.at), fmtTime(e.endAt), fmtDuration(e.endAt - e.at), "", fmtDistance(e.distanceM), "", ""].map(cell).join(","));
        break;
      case "gap":
        lines.push(["No signal", fmtTime(e.at), fmtTime(e.endAt), fmtDuration(e.endAt - e.at), "", "", "", ""].map(cell).join(","));
        break;
    }
  }
  lines.push("");
  lines.push("GPS points");
  lines.push("Time,Latitude,Longitude,Speed km/h,Accuracy m,Battery %");
  for (const p of a.points) {
    lines.push(
      [fmtTime(p.t), p.lat.toFixed(6), p.lng.toFixed(6), p.speed === null ? "" : p.speed.toFixed(1), p.accuracy === null ? "" : Math.round(p.accuracy), p.battery ?? ""]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8"): void {
  // The BOM makes Excel read the file as UTF-8.
  const blob = new Blob(["﻿", text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
