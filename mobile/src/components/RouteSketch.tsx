import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { thin } from '../utils/routeAnalysis';
import { color, radius } from '../theme';

type P = { lat: number; lng: number };

/**
 * A plain line drawing of the day's path (no map tiles needed, so it works
 * without a Google Maps key and offline). North is up. Green = first point,
 * red = last point, amber dots = stops.
 */
export default function RouteSketch({ points, stops, height = 220 }: { points: P[]; stops: P[]; height?: number }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const drawing = useMemo(() => {
    if (width === 0 || points.length === 0) return null;
    const pad = 16;
    const all = [...points, ...stops];
    const lats = all.map((p) => p.lat);
    const lngs = all.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const midLat = (minLat + maxLat) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180); // longitude shrinks away from the equator
    const spanX = Math.max((maxLng - minLng) * kx, 1e-5);
    const spanY = Math.max(maxLat - minLat, 1e-5);
    const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
    const offX = (width - spanX * scale) / 2;
    const offY = (height - spanY * scale) / 2;
    const toXY = (p: P) => ({
      x: offX + (p.lng - minLng) * kx * scale,
      y: offY + (maxLat - p.lat) * scale,
    });

    const path = thin(points, 160).map(toXY);
    const segments = [];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.5) continue;
      segments.push({
        key: i,
        left: (a.x + b.x) / 2 - len / 2,
        top: (a.y + b.y) / 2 - 1.5,
        len,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      });
    }
    return {
      segments,
      start: path[0]!,
      end: path[path.length - 1]!,
      stopDots: stops.map(toXY),
    };
  }, [points, stops, width, height]);

  return (
    <View style={[styles.box, { height }]} onLayout={onLayout} accessibilityLabel="Route drawing">
      {drawing && (
        <>
          {drawing.segments.map((s) => (
            <View
              key={s.key}
              style={[styles.seg, { left: s.left, top: s.top, width: s.len, transform: [{ rotate: `${s.angle}rad` }] }]}
            />
          ))}
          {drawing.stopDots.map((d, i) => (
            <View key={`s${i}`} style={[styles.dot, styles.stop, { left: d.x - 6, top: d.y - 6 }]} />
          ))}
          <View style={[styles.dot, styles.start, { left: drawing.start.x - 7, top: drawing.start.y - 7 }]} />
          <View style={[styles.dot, styles.end, { left: drawing.end.x - 7, top: drawing.end.y - 7 }]} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  seg: { position: 'absolute', height: 3, borderRadius: 1.5, backgroundColor: color.primary, opacity: 0.85 },
  dot: { position: 'absolute', borderWidth: 2, borderColor: color.white },
  start: { width: 14, height: 14, borderRadius: 7, backgroundColor: color.success },
  end: { width: 14, height: 14, borderRadius: 7, backgroundColor: color.error },
  stop: { width: 12, height: 12, borderRadius: 6, backgroundColor: color.warning },
});
