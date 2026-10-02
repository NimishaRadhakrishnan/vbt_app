import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { apiClient } from '../services/api';
import { showSubmitResult } from '../utils/offlineAlert';
import { useDataFetch } from '../hooks/useDataFetch';
import { LoadingState, ErrorState, StaleDataBanner } from '../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../theme';

type Dealer = { id: string; name: string; district: string; village?: string; contact_person?: string; phone: string };
type Product = { id: string; name: string; sku_code: string };

export default function DealerScreen({ navigation }: any) {
  const [selectedDealerId, setSelectedDealerId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [stockQty, setStockQty] = useState('');
  const [orderQty, setOrderQty] = useState('');

  // Previously every audit/order was hardcoded to one fake dealer_id and
  // product_id, so every officer's submission - regardless of which real
  // dealer they were standing in front of - silently wrote to the same
  // dealer's record nationwide. This pulls the real lists instead.
  const { data, loading, error, isStale, retry } = useDataFetch(
    () =>
      Promise.all([
        apiClient.request('/dealers/search', 'GET', 'stock_audit'),
        apiClient.request('/dealers/products/catalog', 'GET', 'stock_audit'),
      ]).then(([dealers, products]) => ({ dealers: dealers || [], products: products || [] })),
    []
  );
  const dealers: Dealer[] = data?.dealers ?? [];
  const products: Product[] = data?.products ?? [];

  const selectedDealer = dealers.find((d) => d.id === selectedDealerId) ?? null;

  const handleStockAudit = async () => {
    if (!selectedDealerId || !selectedProductId || !stockQty) {
      Alert.alert('Required Fields', 'Please select a dealer, a product, and enter audited stock count.');
      return;
    }
    try {
      const res = await apiClient.request(`/dealers/${selectedDealerId}/stock`, 'POST', 'stock_audit', {
        product_id: selectedProductId,
        stock_qty: parseInt(stockQty, 10),
        notes: 'Field audit via mobile app.',
      });
      showSubmitResult(res, 'Audit Saved', 'Dealer stock count updated successfully.');
      setStockQty('');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Audit submission failed.');
    }
  };

  const handlePlaceOrder = async () => {
    if (!selectedDealerId || !selectedProductId || !orderQty) {
      Alert.alert('Required Fields', 'Please select a dealer, a product, and enter order item count.');
      return;
    }
    try {
      const res = await apiClient.request(`/dealers/${selectedDealerId}/orders`, 'POST', 'dealer_order', {
        items: [{ product_id: selectedProductId, quantity: parseInt(orderQty, 10) }],
        comments: 'Order placed via mobile app.',
      });
      showSubmitResult(res, 'Order Booked', 'Dealer purchase order successfully registered.');
      setOrderQty('');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Order submission failed.');
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Dealer Stock & Order Audit</Text>
      {isStale && <StaleDataBanner onRetry={retry} />}

      <View style={styles.dealerMeta}>
        <Text style={styles.fieldLabel}>Select Dealer</Text>
        {dealers.length === 0 ? (
          <Text style={styles.emptyNote}>No dealers found in your area yet.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {dealers.map((d) => (
              <TouchableOpacity
                key={d.id}
                style={[styles.chip, selectedDealerId === d.id && styles.chipActive]}
                onPress={() => setSelectedDealerId(d.id)}
              >
                <Text style={[styles.chipText, selectedDealerId === d.id && styles.chipTextActive]}>{d.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        {selectedDealer && (
          <Text style={styles.dealerDetails}>
            {selectedDealer.district}{selectedDealer.village ? ` · ${selectedDealer.village}` : ''} · {selectedDealer.phone}
          </Text>
        )}
      </View>

      <View style={styles.dealerMeta}>
        <Text style={styles.fieldLabel}>Select Product</Text>
        {products.length === 0 ? (
          <Text style={styles.emptyNote}>No products found in the catalog yet.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {products.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.chip, selectedProductId === p.id && styles.chipActive]}
                onPress={() => setSelectedProductId(p.id)}
              >
                <Text style={[styles.chipText, selectedProductId === p.id && styles.chipTextActive]}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Stock Auditing Block */}
      <View style={styles.card}>
        <Text style={styles.cardHeader}>Audit Current Stock</Text>
        <TextInput
          style={styles.input}
          placeholder="Actual Stock Quantity on Shelf"
          placeholderTextColor={color.textMuted}
          keyboardType="numeric"
          value={stockQty}
          onChangeText={setStockQty}
        />
        <TouchableOpacity style={styles.btnAction} onPress={handleStockAudit}>
          <Text style={styles.btnText}>Save Stock Count</Text>
        </TouchableOpacity>
      </View>

      {/* Order Booking Block */}
      <View style={styles.card}>
        <Text style={styles.cardHeader}>Place New Order</Text>
        <TextInput
          style={styles.input}
          placeholder="Required Order Units"
          placeholderTextColor={color.textMuted}
          keyboardType="numeric"
          value={orderQty}
          onChangeText={setOrderQty}
        />
        <TouchableOpacity style={[styles.btnAction, { backgroundColor: color.info }]} onPress={handlePlaceOrder}>
          <Text style={styles.btnText}>Book Order Invoice</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.btnBack} onPress={() => navigation.goBack()}>
        <Text style={styles.btnBackText}>Go Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.screenBg,
    padding: spacing.xl,
  },
  title: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.primary,
    marginBottom: spacing.lg,
    marginTop: spacing.xl,
  },
  dealerMeta: {
    backgroundColor: '#e8f5e9',
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: color.primaryPale,
    marginBottom: spacing.xl,
  },
  dealerName: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.primary,
  },
  dealerDetails: {
    fontSize: font.caption,
    color: color.success,
    marginTop: spacing.sm,
  },
  fieldLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.primary,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  emptyNote: {
    fontSize: font.body,
    color: color.textMuted,
    fontStyle: 'italic',
  },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: color.primaryPale,
    backgroundColor: color.white,
    marginRight: spacing.sm,
  },
  chipActive: {
    backgroundColor: color.primary,
    borderColor: color.primary,
  },
  chipText: {
    fontSize: font.body,
    fontWeight: fontWeight.semibold,
    color: color.success,
  },
  chipTextActive: {
    color: color.white,
  },
  card: {
    backgroundColor: color.white,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: color.border,
    marginBottom: spacing.xl,
  },
  cardHeader: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: color.borderLight,
    paddingBottom: spacing.sm,
  },
  productLabel: {
    fontSize: font.body,
    color: color.textSecondary,
    marginBottom: spacing.md,
  },
  input: {
    backgroundColor: color.screenBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.subtitle,
    color: color.textPrimary,
    marginBottom: spacing.lg,
  },
  btnAction: {
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    padding: 14,
    alignItems: 'center',
  },
  btnText: {
    color: color.white,
    fontWeight: fontWeight.bold,
    fontSize: font.subtitle,
  },
  btnBack: {
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: 40,
  },
  btnBackText: {
    color: color.primary,
    fontWeight: fontWeight.bold,
    fontSize: font.subtitle,
  },
});
