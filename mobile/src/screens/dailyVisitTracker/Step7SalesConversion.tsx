import React from 'react';
import { Text, View, TouchableOpacity } from 'react-native';
import { spacing } from '../../theme';
import { sharedStyles as styles } from './sharedStyles';
import { FieldRow, TextInputLike, ChipPicker } from './FormFields';

export type Product = { id: string; name: string };
export type SaleProductSel = Record<string, { quantity: string }>;

const CONVERSION_STATUSES = [
  { value: 'interested', label: 'Interested' },
  { value: 'order_placed', label: 'Order Placed' },
  { value: 'converted', label: 'Converted' },
];

type Props = {
  purchased: boolean | null;
  setPurchased: (v: boolean) => void;
  products: Product[];
  loadingProducts: boolean;
  selectedSaleProducts: SaleProductSel;
  onToggleProduct: (productId: string) => void;
  setSelectedSaleProducts: React.Dispatch<React.SetStateAction<SaleProductSel>>;
  orderValue: string;
  setOrderValue: (v: string) => void;
  conversionStatus: string | null;
  setConversionStatus: (v: string) => void;
};

// Section 23. Reuses the same product catalog endpoint VisitScreen and
// DealerScreen already call (GET /dealers/products/catalog) rather than
// a new products list - this section isn't about the officer's own
// trial stock (that's Step 6's /stock/my-stock), it's just "did the
// farmer buy any of our products," so the plain catalog is the right
// data source, not the stock-aware one.
export default function Step7SalesConversion({
  purchased,
  setPurchased,
  products,
  loadingProducts,
  selectedSaleProducts,
  onToggleProduct,
  setSelectedSaleProducts,
  orderValue,
  setOrderValue,
  conversionStatus,
  setConversionStatus,
}: Props) {
  return (
    <View>
      <FieldRow label="Did the farmer purchase paid products?">
        <View style={styles.inlineRow}>
          <TouchableOpacity
            style={[styles.modeChip, { flex: 1, marginRight: spacing.sm }, purchased === true && styles.modeChipActive]}
            onPress={() => setPurchased(true)}
          >
            <Text style={[styles.modeChipText, purchased === true && styles.modeChipTextActive]}>Yes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeChip, { flex: 1 }, purchased === false && styles.modeChipActive]}
            onPress={() => setPurchased(false)}
          >
            <Text style={[styles.modeChipText, purchased === false && styles.modeChipTextActive]}>No</Text>
          </TouchableOpacity>
        </View>
      </FieldRow>

      {purchased === true && (
        <>
          <Text style={styles.sectionHeading}>Products Bought</Text>
          {loadingProducts ? (
            <Text style={styles.placeholderValue}>Loading products…</Text>
          ) : products.length === 0 ? (
            <Text style={styles.placeholderValue}>No products found in the catalog.</Text>
          ) : (
            products.map((p) => {
              const sel = selectedSaleProducts[p.id];
              return (
                <View key={p.id} style={styles.multiSelectRow}>
                  <TouchableOpacity style={styles.checkRow} onPress={() => onToggleProduct(p.id)}>
                    <View style={[styles.checkbox, !!sel && styles.checkboxChecked]}>
                      {!!sel && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text style={styles.checkLabel}>{p.name}</Text>
                  </TouchableOpacity>
                  {sel && (
                    <TextInputLike
                      value={sel.quantity}
                      onChangeText={(v) => setSelectedSaleProducts((prev) => ({ ...prev, [p.id]: { quantity: v } }))}
                      placeholder="Quantity bought"
                      keyboardType="numeric"
                    />
                  )}
                </View>
              );
            })
          )}

          <FieldRow label="Order Value (₹)">
            <TextInputLike value={orderValue} onChangeText={setOrderValue} placeholder="e.g. 2500" keyboardType="numeric" />
          </FieldRow>

          <FieldRow label="Conversion Status">
            <ChipPicker options={CONVERSION_STATUSES} value={conversionStatus} onChange={setConversionStatus} />
          </FieldRow>
        </>
      )}
    </View>
  );
}
