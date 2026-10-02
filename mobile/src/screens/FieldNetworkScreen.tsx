import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { color, font, fontWeight, spacing, radius } from '../theme';
import { apiClient } from '../services/api';

// Grid landing screen for the Field Network tab. Absorbs the 4 tiles that
// used to live directly on the Dashboard grid (Visit, Farmer, Dealer,
// CropIssue) - the destination screens themselves are unchanged.
//
// Role-gated per section 0c/2/3: Field Officers get Farmer/CropIssue/
// Daily-Visit-Tracker-family tiles, Sales Officers get Dealer/Marketing,
// Admin/Manager see all of it. "Field Visit" (quick GPS check-in) stays
// universal - it's a different, older flow than the Daily Visit Tracker
// and nothing in the spec restricts it to one role.
export default function FieldNetworkScreen({ navigation }: any) {
  const role = apiClient.getCurrentUser()?.role ?? '';
  const isOversight = role === 'admin' || role === 'manager';
  const showFieldOfficerTiles = role === 'field_officer' || isOversight;
  const showSalesOfficerTiles = role === 'sales_officer' || isOversight;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>Field Network</Text>
      <View style={styles.grid}>
        <TouchableOpacity
          style={[styles.tile, { backgroundColor: '#e0f2f1' }]}
          onPress={() => navigation.navigate('Visit')}
        >
          <Text style={styles.tileEmoji}>🚗</Text>
          <Text style={styles.tileTitle}>Field Visit</Text>
          <Text style={styles.tileDesc}>Start farmer/dealer visit</Text>
        </TouchableOpacity>

        {showFieldOfficerTiles && (
          <TouchableOpacity
            style={[styles.tile, { backgroundColor: '#f1f8e9' }]}
            onPress={() => navigation.navigate('Farmer')}
          >
            <Text style={styles.tileEmoji}>🌾</Text>
            <Text style={styles.tileTitle}>Register Farmer</Text>
            <Text style={styles.tileDesc}>Add details & coordinates</Text>
          </TouchableOpacity>
        )}

        {showSalesOfficerTiles && (
          <TouchableOpacity
            style={[styles.tile, { backgroundColor: '#efebe9' }]}
            onPress={() => navigation.navigate('Dealer')}
          >
            <Text style={styles.tileEmoji}>🏪</Text>
            <Text style={styles.tileTitle}>Dealer Audit</Text>
            <Text style={styles.tileDesc}>Record stock & orders</Text>
          </TouchableOpacity>
        )}

        {showFieldOfficerTiles && (
          <TouchableOpacity
            style={[styles.tile, { backgroundColor: '#fbe9e7' }]}
            onPress={() => navigation.navigate('CropIssue')}
          >
            <Text style={styles.tileEmoji}>🐛</Text>
            <Text style={styles.tileTitle}>Crop Issue</Text>
            <Text style={styles.tileDesc}>Report disease & photo</Text>
          </TouchableOpacity>
        )}

        {/* Reachable directly, not only through the sign-out gate - an
            officer finishing a dealer visit at 4pm should be able to
            file it then, rather than being forced to wait until they
            happen to log out. */}
        {showSalesOfficerTiles && (
          <TouchableOpacity
            style={[styles.tile, { backgroundColor: '#e8f5e9' }]}
            onPress={() => navigation.navigate('SalesDayClosure')}
          >
            <Text style={styles.tileEmoji}>📋</Text>
            <Text style={styles.tileTitle}>Day Closure</Text>
            <Text style={styles.tileDesc}>Dealer visit, orders, collection</Text>
          </TouchableOpacity>
        )}

        {showFieldOfficerTiles && (
          <>
            <TouchableOpacity
              style={[styles.tile, { backgroundColor: '#fff8e1' }]}
              onPress={() => navigation.navigate('DailyVisitTracker')}
            >
              <Text style={styles.tileEmoji}>📋</Text>
              <Text style={styles.tileTitle}>Daily Visit Tracker</Text>
              <Text style={styles.tileDesc}>Full farmer visit report</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tile, { backgroundColor: '#ede7f6' }]}
              onPress={() => navigation.navigate('MyVisits')}
            >
              <Text style={styles.tileEmoji}>🗂️</Text>
              <Text style={styles.tileTitle}>My Visits</Text>
              <Text style={styles.tileDesc}>View your submitted reports</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tile, { backgroundColor: '#fce4ec' }]}
              onPress={() => navigation.navigate('DraftVisits')}
            >
              <Text style={styles.tileEmoji}>📝</Text>
              <Text style={styles.tileTitle}>Draft Visits</Text>
              <Text style={styles.tileDesc}>Continue an unfinished report</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.screenBg,
  },
  heading: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.primary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  grid: {
    padding: spacing.lg,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  tile: {
    width: '48%',
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: color.border,
    shadowColor: color.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  tileEmoji: {
    fontSize: font.heading,
    marginBottom: spacing.md,
  },
  tileTitle: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
  },
  tileDesc: {
    fontSize: font.caption,
    color: color.textSecondary,
    marginTop: spacing.xs,
  },
});
