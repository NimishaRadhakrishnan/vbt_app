import React, { useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SectionList,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../services/api';
import { useDataFetch } from '../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState, StaleDataBanner } from '../components/FetchStates';
import { showSubmitResult } from '../utils/offlineAlert';
import { color, font, fontWeight, spacing, radius } from '../theme';

// Stock in hand for field and sales officers.
// GET /stock/my-stock returns every active product with this officer's
// balance (zero when never held). POST /stock/request {product_id, quantity}
// notifies admins and managers; any signed-in user may call it.

// Fields exactly as StockItem in stock_router.py.
type StockItem = {
  product_id: string;
  product_name: string;
  sku_code: string;
  current_quantity: number;
  unit: string | null;
  last_movement_at: string | null;
};

// Same threshold as the web My Stock page, so both always agree on "low".
const LOW_STOCK_THRESHOLD = 5;
const MIN_TOUCH = 44;
const MAX_SUGGESTIONS = 6;

type StockSection = { key: 'low' | 'ok'; title: string; data: StockItem[] };

function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const head = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${intPart.slice(-3)}`;
}

// Indian digit grouping, up to 2 decimals, no trailing zeros.
function formatQty(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const [whole, fraction] = Math.abs(value).toFixed(2).split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${value < 0 ? '-' : ''}${groupIndian(whole)}${trimmed ? `.${trimmed}` : ''}`;
}

// Indian time whatever the phone's zone is; microseconds trimmed so every JS
// engine parses the value.
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.replace(/(\.\d{3})\d+/, '$1'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function unitLabel(item: StockItem): string {
  return item.unit && item.unit.trim() ? item.unit.trim() : 'units';
}

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}

// The server needs a number greater than 0. Cap the size so a slipped key
// cannot send an absurd request.
function parseRequestQuantity(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function MyStockScreen() {
  const [requestFor, setRequestFor] = useState<{ product: StockItem | null } | null>(null);

  const { data, loading, refreshing, error, isStale, retry, refresh } = useDataFetch<StockItem[]>(
    () => apiClient.request('/stock/my-stock', 'GET', 'stock_audit')
  );

  const items = useMemo<StockItem[]>(() => (Array.isArray(data) ? data : []), [data]);

  const sections = useMemo<StockSection[]>(() => {
    const byName = (a: StockItem, b: StockItem) => a.product_name.localeCompare(b.product_name);
    const low = items
      .filter((i) => i.current_quantity <= LOW_STOCK_THRESHOLD)
      .sort((a, b) => a.current_quantity - b.current_quantity || byName(a, b));
    const ok = items.filter((i) => i.current_quantity > LOW_STOCK_THRESHOLD).sort(byName);
    const result: StockSection[] = [];
    if (low.length > 0) result.push({ key: 'low', title: 'Low or out of stock', data: low });
    if (ok.length > 0) result.push({ key: 'ok', title: 'In stock', data: ok });
    return result;
  }, [items]);

  const lowCount = sections.find((s) => s.key === 'low')?.data.length ?? 0;
  const inStockCount = items.filter((i) => i.current_quantity > 0).length;

  let body: React.ReactNode;
  if (loading) {
    body = <LoadingState />;
  } else if (error) {
    body = <ErrorState message={error} onRetry={retry} />;
  } else if (items.length === 0) {
    body = <EmptyState message="No products are available yet." actionHint="Pull down to refresh." />;
  } else {
    body = (
      <SectionList
        sections={sections}
        keyExtractor={(i) => i.product_id}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        refreshing={refreshing}
        onRefresh={refresh}
        ListHeaderComponent={
          <View style={styles.summary}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{groupIndian(String(items.length))}</Text>
              <Text style={styles.summaryLabel}>{items.length === 1 ? 'Product line' : 'Product lines'}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{groupIndian(String(inStockCount))}</Text>
              <Text style={styles.summaryLabel}>With stock</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, lowCount > 0 && { color: color.error }]}>{groupIndian(String(lowCount))}</Text>
              <Text style={styles.summaryLabel}>Low or out</Text>
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>
            {section.title} ({groupIndian(String(section.data.length))})
          </Text>
        )}
        renderItem={({ item }) => {
          const low = item.current_quantity <= LOW_STOCK_THRESHOLD;
          const date = formatDate(item.last_movement_at);
          return (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.cardInfo}>
                  <Text style={styles.name} numberOfLines={2}>{item.product_name}</Text>
                  <Text style={styles.meta}>{item.sku_code}</Text>
                </View>
                <View style={styles.qtyWrap}>
                  <Text style={[styles.qty, low && { color: color.error }]}>{formatQty(item.current_quantity)}</Text>
                  <Text style={styles.unit}>{unitLabel(item)}</Text>
                </View>
              </View>
              <View style={styles.cardBottom}>
                <Text style={styles.meta}>{date ? `Last change ${date}` : 'No stock movement yet'}</Text>
                <TouchableOpacity
                  style={styles.rowRequestBtn}
                  onPress={() => setRequestFor({ product: item })}
                  accessibilityRole="button"
                  accessibilityLabel={`Request more ${item.product_name}`}
                >
                  <Ionicons name="add-circle-outline" size={18} color={color.primary} />
                  <Text style={styles.rowRequestText}>Request</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.topText}>Stock allocated to you</Text>
        <TouchableOpacity
          style={[styles.requestBtn, (loading || items.length === 0) && styles.disabled]}
          onPress={() => setRequestFor({ product: null })}
          disabled={loading || items.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Request stock"
        >
          <Ionicons name="paper-plane-outline" size={18} color={color.white} />
          <Text style={styles.requestBtnText}>Request stock</Text>
        </TouchableOpacity>
      </View>
      {isStale && !loading && !error && <StaleDataBanner onRetry={refresh} />}
      {body}

      <RequestStockModal
        visible={requestFor !== null}
        initialProduct={requestFor?.product ?? null}
        products={items}
        onClose={() => setRequestFor(null)}
      />
    </View>
  );
}

function RequestStockModal({
  visible,
  initialProduct,
  products,
  onClose,
}: {
  visible: boolean;
  initialProduct: StockItem | null;
  products: StockItem[];
  onClose: () => void;
}) {
  // The modal is only mounted with content while visible, so each opening
  // starts with a clean form.
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {visible ? <RequestForm initialProduct={initialProduct} products={products} onClose={onClose} /> : null}
    </Modal>
  );
}

function RequestForm({
  initialProduct,
  products,
  onClose,
}: {
  initialProduct: StockItem | null;
  products: StockItem[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<StockItem | null>(initialProduct);
  const [query, setQuery] = useState('');
  const [quantityText, setQuantityText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? products.filter((p) => p.product_name.toLowerCase().includes(q) || p.sku_code.toLowerCase().includes(q))
      : products;
    return list;
  }, [products, query]);

  const close = () => {
    if (busyRef.current) return;
    onClose();
  };

  const submit = async () => {
    if (busyRef.current) return;
    if (!selected) {
      setFormError('Choose the product you need.');
      return;
    }
    const quantity = parseRequestQuantity(quantityText);
    if (quantity === null) {
      setFormError('Enter how many you need, more than 0 (up to 2 decimal places).');
      return;
    }
    busyRef.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await apiClient.request('/stock/request', 'POST', 'stock_audit', {
        product_id: selected.product_id,
        quantity,
      });
      busyRef.current = false;
      setSubmitting(false);
      onClose();
      if (result?.offline) {
        showSubmitResult(result, '', '');
      } else if (typeof result?.notified_count === 'number' && result.notified_count === 0) {
        Alert.alert(
          'Request Not Delivered',
          'There is no active manager or admin to receive your request. Please contact your manager directly.'
        );
      } else {
        Alert.alert(
          'Request Sent',
          `Your request for ${formatQty(quantity)} ${unitLabel(selected)} of ${selected.product_name} was sent to your manager and admin.`
        );
      }
    } catch (err) {
      busyRef.current = false;
      setSubmitting(false);
      setFormError(errorMessage(err, 'Could not send your request. Please try again.'));
    }
  };

  return (
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Request stock</Text>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={close}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Close request form"
          >
            <Ionicons name="close" size={24} color={color.textPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
          <Text style={styles.fieldLabel}>Product</Text>
          {selected ? (
            <View style={styles.selectedRow}>
              <View style={styles.cardInfo}>
                <Text style={styles.name} numberOfLines={2}>{selected.product_name}</Text>
                <Text style={styles.meta}>
                  {selected.sku_code} · You have {formatQty(selected.current_quantity)} {unitLabel(selected)}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.changeBtn}
                onPress={() => setSelected(null)}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Choose a different product"
              >
                <Text style={styles.changeBtnText}>Change</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={query}
                onChangeText={setQuery}
                placeholder="Search by name or SKU"
                placeholderTextColor={color.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Search products to request"
              />
              {matches.length === 0 ? (
                <Text style={styles.hintText}>No products match your search.</Text>
              ) : (
                matches.slice(0, MAX_SUGGESTIONS).map((p) => (
                  <TouchableOpacity
                    key={p.product_id}
                    style={styles.option}
                    onPress={() => {
                      setSelected(p);
                      setFormError(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Choose ${p.product_name}`}
                  >
                    <Text style={styles.optionName} numberOfLines={1}>{p.product_name}</Text>
                    <Text style={styles.meta}>{p.sku_code}</Text>
                  </TouchableOpacity>
                ))
              )}
              {matches.length > MAX_SUGGESTIONS && (
                <Text style={styles.hintText}>
                  Showing {MAX_SUGGESTIONS} of {groupIndian(String(matches.length))}. Type to narrow the list.
                </Text>
              )}
            </>
          )}

          <Text style={styles.fieldLabel}>
            {selected ? `How many ${unitLabel(selected)} do you need?` : 'How many do you need?'}
          </Text>
          <TextInput
            style={styles.input}
            value={quantityText}
            onChangeText={setQuantityText}
            keyboardType="decimal-pad"
            maxLength={10}
            placeholder="For example 20"
            placeholderTextColor={color.textMuted}
            accessibilityLabel="Quantity needed"
          />

          {!!formError && <Text style={styles.errorText}>{formError}</Text>}

          <View style={styles.formActions}>
            <TouchableOpacity
              style={[styles.cancelBtn, submitting && styles.disabled]}
              onPress={close}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Cancel request"
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendBtn, submitting && styles.disabled]}
              onPress={submit}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={submitting ? 'Sending request' : 'Send request'}
            >
              {submitting ? <ActivityIndicator color={color.white} size="small" /> : <Text style={styles.sendBtnText}>Send request</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  disabled: { opacity: 0.5 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  topText: { flex: 1, fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginRight: spacing.sm },
  requestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    minHeight: MIN_TOUCH,
  },
  requestBtnText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.body, marginLeft: spacing.xs },
  listContent: { padding: spacing.lg, paddingTop: spacing.sm },
  summary: {
    flexDirection: 'row',
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: font.title, fontWeight: fontWeight.bold, color: color.textPrimary },
  summaryLabel: { fontSize: font.caption, color: color.textSecondary, marginTop: 2, textAlign: 'center' },
  sectionTitle: {
    fontSize: font.body,
    fontWeight: fontWeight.semibold,
    color: color.textSecondary,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardInfo: { flex: 1, marginRight: spacing.md },
  name: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  meta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  qtyWrap: { alignItems: 'flex-end' },
  qty: { fontSize: font.title, fontWeight: fontWeight.bold, color: color.primary },
  unit: { fontSize: font.caption, color: color.textSecondary },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: color.borderLight,
  },
  rowRequestBtn: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH, paddingLeft: spacing.md },
  rowRequestText: { color: color.primary, fontWeight: fontWeight.bold, fontSize: font.body, marginLeft: spacing.xs },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: color.overlay },
  sheet: {
    backgroundColor: color.cardBg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '90%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingTop: spacing.sm,
  },
  sheetTitle: { fontSize: font.title, fontWeight: fontWeight.bold, color: color.textPrimary },
  closeBtn: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  sheetBody: { padding: spacing.lg, paddingTop: spacing.sm },
  fieldLabel: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: MIN_TOUCH,
    fontSize: font.body,
    color: color.textPrimary,
  },
  option: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  optionName: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  changeBtn: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  changeBtnText: { color: color.primary, fontWeight: fontWeight.bold, fontSize: font.body },
  hintText: { fontSize: font.caption, color: color.textSecondary, marginTop: spacing.sm },
  errorText: { fontSize: font.body, color: color.error, marginTop: spacing.md },
  formActions: { flexDirection: 'row', marginTop: spacing.xl },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.primary,
    borderRadius: radius.sm,
    minHeight: MIN_TOUCH,
    marginRight: spacing.sm,
  },
  cancelBtnText: { color: color.primary, fontWeight: fontWeight.bold, fontSize: font.body },
  sendBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    minHeight: MIN_TOUCH,
  },
  sendBtnText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.body },
});
