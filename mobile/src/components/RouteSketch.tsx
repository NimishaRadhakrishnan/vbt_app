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
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const p of points.concat(stops)) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    const midLat = (minLat + maxLat) / 2;
    const midLng = (minLng + maxLng) / 2;
    const kx = Math.max(Math.cos((midLat * Math.PI) / 180), 0.01); // longitude shrinks away from the equator
    // Never zoom in past about 110 m across, so a parked phone's GPS jitter,
    // a single point, or identical points do not blow up into a scribble.
    const MIN_SPAN = 0.001;
    const spanX = Math.max((maxLng - minLng) * kx, MIN_SPAN);
    const spanY = Math.max(maxLat - minLat, MIN_SPAN);
    const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
    // Centre the bounding box in the frame (north up, so y runs downwards).
    const toXY = (p: P) => ({
      x: width / 2 + (p.lng - midLng) * kx * scale,
      y: height / 2 - (p.lat - midLat) * scale,
    });

    const path = thin(points, 160).map(toXY);
    const segments: { key: number; left: number; top: number; len: number; angle: number }[] = [];
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
    <View style={[styles.box, { height }]} onLayout={onLayout} accessibilityRole="image"
      accessibilityLabel="Drawing of the day's route. Green dot is the start, red dot is the last position, amber dots are stops.">
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
