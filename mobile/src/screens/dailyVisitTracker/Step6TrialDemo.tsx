import React from 'react';
import { Text, View, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { apiClient } from '../../services/api';
import { color, font, spacing } from '../../theme';
import { sharedStyles as styles } from './sharedStyles';
import { FieldRow, TextInputLike, ChipPicker } from './FormFields';

export type StockItem = {
  product_id: string;
  product_name: string;
  sku_code: string;
  opening_stock: number;
  received_stock: number;
  given_so_far: number;
  remaining_stock: number;
};

export type TrialProductSel = Record<string, { quantityGiven: string }>;

const VISIT_PURPOSES = [
  { value: 'new_contact', label: 'New Contact' },
  { value: 'demo_setup', label: 'Demo Setup' },
  { value: 'routine_follow_up', label: 'Routine Follow-up' },
  { value: 'field_day', label: 'Field Day' },
];

const DEMO_STATUSES = [
  { value: 'agreed', label: 'Agreed' },
  { value: 'started_today', label: 'Started Today' },
  { value: 'running', label: 'Running' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
  { value: 'converted', label: 'Converted' },
];

type Props = {
  isTrial: boolean | null;
  setIsTrial: (v: boolean) => void;
  visitPurpose: string | null;
  setVisitPurpose: (v: string) => void;
  demoStatus: string | null;
  setDemoStatus: (v: string) => void;
  trialPlotSize: string;
  setTrialPlotSize: (v: string) => void;
  stockItems: StockItem[];
  loadingStock: boolean;
  selectedTrialProducts: TrialProductSel;
  onToggleProduct: (productId: string) => void;
  setSelectedTrialProducts: React.Dispatch<React.SetStateAction<TrialProductSel>>;
};

// Sections 18-22. Deliberately reuses the existing Trial infrastructure
// from earlier phases (is_trial + visit_trial_products already exist on
// the backend from the mobile VisitScreen work) rather than building a
// second trial-tracking system - this step just captures the extra
// purpose/status/plot-size detail the Daily Visit Tracker spec adds on
// top, and enforces the stock ceiling live (per-product remaining stock
// comes from the real GET /stock/my-stock endpoint, not a guess).
export default function Step6TrialDemo({
  isTrial,
  setIsTrial,
  visitPurpose,
  setVisitPurpose,
  demoStatus,
  setDemoStatus,
  trialPlotSize,
  setTrialPlotSize,
  stockItems,
  loadingStock,
  selectedTrialProducts,
  onToggleProduct,
  setSelectedTrialProducts,
}: Props) {
  return (
    <View>
      <FieldRow label="Trial / Demo">
        <View style={styles.inlineRow}>
          <TouchableOpacity
            style={[styles.modeChip, { flex: 1, marginRight: spacing.sm }, isTrial === true && styles.modeChipActive]}
            onPress={() => setIsTrial(true)}
          >
            <Text style={[styles.modeChipText, isTrial === true && styles.modeChipTextActive]}>Yes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeChip, { flex: 1 }, isTrial === false && styles.modeChipActive]}
            onPress={() => setIsTrial(false)}
          >
            <Text style={[styles.modeChipText, isTrial === false && styles.modeChipTextActive]}>No</Text>
          </TouchableOpacity>
        </View>
      </FieldRow>

      {isTrial === true && (
        <>
          <FieldRow label="Visit Purpose">
            <ChipPicker options={VISIT_PURPOSES} value={visitPurpose} onChange={setVisitPurpose} />
          </FieldRow>

          <FieldRow label="Demo Status">
            <ChipPicker options={DEMO_STATUSES} value={demoStatus} onChange={setDemoStatus} />
          </FieldRow>

          <FieldRow label="Trial Plot Size (cents)">
            <TextInputLike value={trialPlotSize} onChangeText={setTrialPlotSize} placeholder="e.g. 0.5" keyboardType="numeric" />
          </FieldRow>

          <Text style={styles.sectionHeading}>Trial Products</Text>
          {loadingStock ? (
            <Text style={styles.placeholderValue}>Loading your stock…</Text>
          ) : stockItems.length === 0 ? (
            <Text style={styles.placeholderValue}>No products found in the catalog.</Text>
          ) : (
            stockItems.map((item) => {
              const sel = selectedTrialProducts[item.product_id];
              const outOfStock = item.remaining_stock <= 0;
              const givenNum = Number(sel?.quantityGiven || 0);
              const overStock = !!sel && givenNum > item.remaining_stock;
              return (
                <View key={item.product_id} style={styles.multiSelectRow}>
                  {outOfStock ? (
                    <View style={{ paddingVertical: 8 }}>
                      <Text style={{ color: color.textSecondary, marginBottom: 8, fontSize: font.caption }}>
                        You have no {item.product_name} with you. Ask your manager to issue stock.
                      </Text>
                      <TouchableOpacity
                        style={{ backgroundColor: color.primary, padding: 8, borderRadius: 4, alignSelf: 'flex-start' }}
                        onPress={() => {
                          apiClient.request('/stock/request', 'POST', 'plan_submit', { product_id: item.product_id, quantity: 1 })
                            .then(() => Alert.alert('Success', 'Stock request sent to admin.'))
                            .catch(() => Alert.alert('Error', 'Failed to request stock.'));
                        }}
                      >
                        <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>Request stock</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                  <TouchableOpacity
                    style={styles.checkRow}
                    onPress={() => onToggleProduct(item.product_id)}
                  >
                    <View style={[styles.checkbox, !!sel && styles.checkboxChecked]}>
                      {!!sel && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.checkLabel}>{item.product_name}</Text>
                      <Text style={localStyles.stockLine}>
                        Remaining: {item.remaining_stock}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  )}
                  {sel && !outOfStock && (
                    <>
                      <TextInputLike
                        value={sel.quantityGiven}
                        onChangeText={(v) => setSelectedTrialProducts((prev) => ({ ...prev, [item.product_id]: { quantityGiven: v } }))}
                        placeholder="Quantity given"
                        keyboardType="numeric"
                      />
                      {overStock && (
                        <Text style={styles.errorText}>
                          You have {item.remaining_stock} left. Enter {item.remaining_stock} or less.
                        </Text>
                      )}
                    </>
                  )}
                </View>
              );
            })
          )}
        </>
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
  rowDisabled: {
    opacity: 0.5,
  },
  stockLine: {
    fontSize: font.caption,
    color: color.textSecondary,
    marginTop: 2,
  },
});
