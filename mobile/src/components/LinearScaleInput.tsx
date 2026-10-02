import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { color, font, fontWeight, spacing } from '../theme';

type Props = {
  value: number | null;
  onChange: (value: number) => void;
  lowLabel: string;
  highLabel: string;
  min?: number;
  max?: number;
};

// Google-Forms-style linear scale, rebuilt against the actual reference
// screenshot (the first version of this component was built from a text
// description only, before the image was available - two real mismatches
// corrected here):
//
// 1. Endpoint labels sit BESIDE the circle row on the same line
//    (label - circles - label), not stacked below it as first built.
//    On a phone this makes the row tight, so the two label columns are a
//    fixed width with wrapping allowed (2 lines) rather than one long
//    line, and the circle/number columns shrink to fill what's left -
//    still no horizontal scroll, checked against 360px.
// 2. The reference shows selection as a soft circular halo behind an
//    otherwise outlined (not solid-filled) circle - not a solid dot.
//    Reproduced with `primaryLight` (already in theme/index.ts,
//    documented there as "used for pressed/active states") rather than
//    introducing Google's lavender, which has nothing to do with this
//    app's own color identity.
const LABEL_COLUMN_WIDTH = 56;

export default function LinearScaleInput({ value, onChange, lowLabel, highLabel, min = 1, max = 10 }: Props) {
  const screenWidth = Dimensions.get('window').width;
  const usableWidth = screenWidth - spacing.lg * 2;
  const scaleWidth = Math.max(120, usableWidth - LABEL_COLUMN_WIDTH * 2 - spacing.sm * 2);
  const columnCount = max - min + 1;
  const columnWidth = Math.max(16, Math.floor(scaleWidth / columnCount));
  const circleSize = Math.min(24, columnWidth - 6);
  const haloSize = circleSize + 12;

  const numbers = Array.from({ length: columnCount }, (_, i) => min + i);

  return (
    <View style={styles.container}>
      {/* Number header row - aligned above just the circle columns,
          with matching spacers on either side for the label columns. */}
      <View style={styles.row}>
        <View style={{ width: LABEL_COLUMN_WIDTH }} />
        {numbers.map((n) => (
          <View key={n} style={[styles.column, { width: columnWidth }]}>
            <Text style={styles.numberLabel}>{n}</Text>
          </View>
        ))}
        <View style={{ width: LABEL_COLUMN_WIDTH }} />
      </View>

      <View style={styles.row}>
        <Text style={[styles.endpointLabel, { width: LABEL_COLUMN_WIDTH }]}>{lowLabel}</Text>
        {numbers.map((n) => {
          const selected = value === n;
          return (
            <TouchableOpacity
              key={n}
              style={[styles.column, { width: columnWidth }]}
              onPress={() => onChange(n)}
              // Circle itself may be small on a narrow screen, but the
              // tappable area is the full column width/a generous
              // vertical hitSlop - keeps the real tap target near the
              // 44px minimum even where the visible circle can't be.
              hitSlop={{ top: 10, bottom: 10, left: 2, right: 2 }}
            >
              <View style={[styles.halo, { width: haloSize, height: haloSize, borderRadius: haloSize / 2 }, selected && styles.haloActive]}>
                <View style={[styles.circle, { width: circleSize, height: circleSize, borderRadius: circleSize / 2 }, selected && styles.circleActive]} />
              </View>
            </TouchableOpacity>
          );
        })}
        <Text style={[styles.endpointLabel, styles.endpointLabelRight, { width: LABEL_COLUMN_WIDTH }]}>{highLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  column: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberLabel: {
    fontSize: font.caption - 1,
    fontWeight: fontWeight.semibold,
    color: color.textSecondary,
    marginBottom: 4,
    textAlign: 'center',
  },
  halo: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  haloActive: {
    backgroundColor: color.primaryLight,
  },
  circle: {
    borderWidth: 2,
    borderColor: color.border,
    backgroundColor: color.cardBg,
  },
  circleActive: {
    borderColor: color.primary,
  },
  endpointLabel: {
    fontSize: font.caption - 1,
    color: color.textMuted,
  },
  endpointLabelRight: {
    textAlign: 'right',
  },
});
