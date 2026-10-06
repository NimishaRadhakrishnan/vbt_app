import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState, StaleDataBanner } from '../../components/FetchStates';
import { showSubmitResult } from '../../utils/offlineAlert';
import { color, font, fontWeight, spacing, radius } from '../../theme';

// Admin-only product catalogue and pricing. Mirrors the web page at
// frontend/app/dashboard/products (admin_router.py: /admin/products*).
// Bulk import is web-only (it needs a file upload).

// Fields exactly as AdminProductResponse returns them.
type Product = {
  id: string;
  name: string;
  category: string;
  sku_code: string;
  price: number;
  description: string | null;
  is_active: boolean;
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
};

// Fields exactly as PriceTierResponse returns them. `price` is a Decimal on
// the server, which FastAPI sends as a string.
type PriceTier = {
  id: string;
  product_id: string;
  product_name: string | null;
  sku_code: string | null;
  dealer_id: string | null;
  dealer_name: string | null;
  min_quantity: number;
  max_quantity: number | null;
  price: string | number;
  band_label: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

// PriceQuoteResponse
type PriceQuote = {
  product_id: string;
  quantity: number;
  unit_price: string | number;
  line_total: string | number;
  source: string;
  source_label: string;
  band_label: string;
  note: string | null;
};

type ProductValues = {
  name: string;
  category: string;
  sku_code: string;
  price: number;
  description: string;
};

type TierValues = {
  min_quantity: number;
  max_quantity: number | null;
  price: number;
};

// Limits from the database columns (name 200, category 100, sku 100,
// price Numeric(12,2)) and the schema (quantities are 32-bit integers).
const NAME_MAX = 200;
const CATEGORY_MAX = 100;
const SKU_MAX = 100;
const PRICE_MAX_INTEGER_DIGITS = 10;
const MAX_QUANTITY = 2147483646;
const MIN_TOUCH = 44;

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}

function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const head = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${intPart.slice(-3)}`;
}

// Indian digit grouping, e.g. 1234567.5 -> "Rs 12,34,567.50" (with the rupee sign).
function formatRupees(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const [whole, fraction] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}₹${groupIndian(whole)}.${fraction}`;
}

function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '-';
  return `${n < 0 ? '-' : ''}${groupIndian(String(Math.trunc(Math.abs(n))))}`;
}

// Shown in Indian time whatever the phone's zone is. Fractions beyond
// milliseconds (the server sends microseconds) are trimmed so every JS engine
// parses the value.
function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso.replace(/(\.\d{3})\d+/, '$1'));
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

// Accepts digits with up to 2 decimals (the column is Numeric(12,2)).
function parsePrice(text: string): number | null {
  const t = text.trim();
  if (!new RegExp(`^\\d{1,${PRICE_MAX_INTEGER_DIGITS}}(\\.\\d{1,2})?$`).test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseQuantity(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_QUANTITY ? n : null;
}

export default function AdminProductsScreen() {
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState<null | { mode: 'create' } | { mode: 'edit'; product: Product }>(null);
  const [tierEdit, setTierEdit] = useState<PriceTier | null>(null);
  const [tiersVersion, setTiersVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // Changes the server confirmed, shown straight away until the refetch lands.
  const [overrides, setOverrides] = useState<Record<string, Product>>({});
  const [added, setAdded] = useState<Product[]>([]);
  const busyRef = useRef(false);
  const insets = useSafeAreaInsets();

  const { data, loading, refreshing, error, isStale, retry, refresh } = useDataFetch<Product[]>(
    () => apiClient.request('/admin/products?include_inactive=true', 'GET', 'admin_action'),
    [],
    { refetchOnFocus: false }
  );

  useEffect(() => {
    setOverrides({});
    setAdded([]);
  }, [data]);

  const products = useMemo<Product[]>(() => {
    const base = Array.isArray(data) ? data : [];
    const ids = new Set(base.map((p) => p.id));
    const merged = base.map((p) => overrides[p.id] ?? p).concat(added.filter((p) => !ids.has(p.id)));
    return merged.sort((a, b) => a.name.localeCompare(b.name));
  }, [data, overrides, added]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!showInactive && !p.is_active) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku_code.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [products, search, showInactive]);

  const detailProduct = detailId ? products.find((p) => p.id === detailId) ?? null : null;
  const modalOpen = detailProduct !== null || form !== null;

  const runExclusive = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setServerError(null);
    try {
      await work();
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const closeTop = () => {
    if (busyRef.current) return;
    setServerError(null);
    if (tierEdit) {
      setTierEdit(null);
    } else if (form) {
      setForm(null);
    } else {
      setDetailId(null);
    }
  };

  const createProduct = (values: ProductValues) =>
    runExclusive(async () => {
      try {
        const body: Record<string, unknown> = {
          name: values.name,
          category: values.category,
          sku_code: values.sku_code,
          price: values.price,
        };
        if (values.description) body.description = values.description;
        const result = await apiClient.request('/admin/products', 'POST', 'admin_action', body);
        if (result?.offline) {
          setForm(null);
          showSubmitResult(result, '', '');
          return;
        }
        setAdded((prev) => [...prev, result as Product]);
        setForm(null);
        refresh();
        Alert.alert('Product Added', `${values.name} is now in the catalogue.`);
      } catch (err) {
        setServerError(errorMessage(err, 'Could not add the product. Please try again.'));
      }
    });

  const saveProduct = (product: Product, values: ProductValues) =>
    runExclusive(async () => {
      // Send only what changed; the server rejects an empty update.
      const body: Record<string, unknown> = {};
      if (values.name !== product.name) body.name = values.name;
      if (values.category !== product.category) body.category = values.category;
      if (values.sku_code !== product.sku_code) body.sku_code = values.sku_code;
      if (values.price !== Number(product.price)) body.price = values.price;
      if (values.description !== (product.description ?? '')) body.description = values.description || null;
      if (Object.keys(body).length === 0) {
        setForm(null);
        return;
      }
      try {
        const result = await apiClient.request(`/admin/products/${product.id}`, 'PATCH', 'admin_action', body);
        if (result?.offline) {
          setForm(null);
          showSubmitResult(result, '', '');
          return;
        }
        setOverrides((prev) => ({ ...prev, [product.id]: result as Product }));
        setForm(null);
        refresh();
      } catch (err) {
        setServerError(errorMessage(err, 'Could not save the changes. Please try again.'));
      }
    });

  const setActive = (product: Product, active: boolean) =>
    runExclusive(async () => {
      try {
        // Web behaviour: deactivate is DELETE (a soft delete on the server),
        // reactivate is a PATCH of is_active.
        const result = active
          ? await apiClient.request(`/admin/products/${product.id}`, 'PATCH', 'admin_action', { is_active: true })
          : await apiClient.request(`/admin/products/${product.id}`, 'DELETE', 'admin_action');
        if (result?.offline) {
          showSubmitResult(result, '', '');
          return;
        }
        const updated: Product = active ? (result as Product) : { ...product, is_active: false };
        setOverrides((prev) => ({ ...prev, [product.id]: updated }));
        refresh();
      } catch (err) {
        Alert.alert(
          active ? 'Could Not Reactivate' : 'Could Not Deactivate',
          errorMessage(err, 'Please try again.')
        );
      }
    });

  const confirmDeactivate = (product: Product) => {
    if (busyRef.current) return;
    Alert.alert(
      'Deactivate Product',
      `Deactivate "${product.name}"? It will stop appearing when stock is issued or dealers place orders. Past orders and stock history are not changed. You can reactivate it later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Deactivate', style: 'destructive', onPress: () => setActive(product, false) },
      ]
    );
  };

  const saveTier = (tier: PriceTier, values: TierValues) =>
    runExclusive(async () => {
      const body: Record<string, unknown> = {};
      if (values.min_quantity !== tier.min_quantity) body.min_quantity = values.min_quantity;
      if (values.max_quantity !== tier.max_quantity) body.max_quantity = values.max_quantity;
      if (values.price !== Number(tier.price)) body.price = values.price;
      if (Object.keys(body).length === 0) {
        setTierEdit(null);
        return;
      }
      try {
        const result = await apiClient.request(
          `/admin/products/price-tiers/${tier.id}`,
          'PATCH',
          'admin_action',
          body
        );
        if (result?.offline) {
          setTierEdit(null);
          showSubmitResult(result, '', '');
          return;
        }
        setTierEdit(null);
        setTiersVersion((v) => v + 1);
      } catch (err) {
        setServerError(errorMessage(err, 'Could not save the price band. Please try again.'));
      }
    });

  const openCreate = () => {
    setServerError(null);
    setForm({ mode: 'create' });
  };

  let body: React.ReactNode;
  if (loading) {
    body = <LoadingState />;
  } else if (error) {
    body = <ErrorState message={error} onRetry={retry} />;
  } else if (products.length === 0) {
    body = <EmptyState message="No products yet." actionHint="Tap Add product to create the first one." />;
  } else {
    body = (
      <FlatList
        data={visible}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        refreshing={refreshing}
        onRefresh={refresh}
        ListHeaderComponent={
          <Text style={styles.countText}>
            {visible.length === 1 ? '1 product' : `${formatCount(visible.length)} products`}
          </Text>
        }
        ListEmptyComponent={
          <Text style={styles.noMatch}>No products match your search.</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, !item.is_active && styles.cardInactive]}
            onPress={() => setDetailId(item.id)}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${formatRupees(item.price)}, ${item.is_active ? 'active' : 'inactive'}. Open details`}
          >
            <View style={styles.cardTop}>
              <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
              <StatusPill active={item.is_active} />
            </View>
            <Text style={styles.meta} numberOfLines={1}>{item.category} · {item.sku_code}</Text>
            <View style={styles.cardBottom}>
              <Text style={styles.price}>{formatRupees(item.price)}</Text>
              <Ionicons name="chevron-forward" size={20} color={color.textMuted} />
            </View>
          </TouchableOpacity>
        )}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={20} color={color.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, SKU or category"
            placeholderTextColor={color.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search products"
          />
          {search.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearch('')}
              style={styles.clearBtn}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={20} color={color.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.toolbarRow}>
          <TouchableOpacity
            style={styles.toggle}
            onPress={() => setShowInactive((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityLabel="Show inactive products"
            accessibilityState={{ checked: showInactive }}
          >
            <Ionicons
              name={showInactive ? 'checkbox' : 'square-outline'}
              size={24}
              color={showInactive ? color.primary : color.textSecondary}
            />
            <Text style={styles.toggleText}>Show inactive</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={openCreate}
            accessibilityRole="button"
            accessibilityLabel="Add product"
          >
            <Ionicons name="add" size={20} color={color.white} />
            <Text style={styles.addBtnText}>Add product</Text>
          </TouchableOpacity>
        </View>
      </View>

      {isStale && !loading && !error && <StaleDataBanner onRetry={refresh} />}
      {body}

      <Modal visible={modalOpen} animationType="slide" onRequestClose={closeTop}>
        <View style={[styles.modalRoot, { paddingTop: Platform.OS === 'ios' ? insets.top : 0 }]}>
          <View style={styles.modalInner}>
          {detailProduct && (
            <View style={[styles.flex, (form || tierEdit) && styles.hidden]}>
              <ProductDetail
                product={detailProduct}
                tiersVersion={tiersVersion}
                busy={saving}
                onBack={closeTop}
                onEdit={() => {
                  setServerError(null);
                  setForm({ mode: 'edit', product: detailProduct });
                }}
                onDeactivate={() => confirmDeactivate(detailProduct)}
                onReactivate={() => setActive(detailProduct, true)}
                onEditTier={(t) => {
                  setServerError(null);
                  setTierEdit(t);
                }}
              />
            </View>
          )}
          {form && !tierEdit && (
            <ProductForm
              key={form.mode === 'edit' ? form.product.id : 'new'}
              initial={form.mode === 'edit' ? form.product : null}
              saving={saving}
              serverError={serverError}
              onCancel={closeTop}
              onSubmit={(values) => (form.mode === 'edit' ? saveProduct(form.product, values) : createProduct(values))}
            />
          )}
          {tierEdit && (
            <TierForm
              key={tierEdit.id}
              tier={tierEdit}
              saving={saving}
              serverError={serverError}
              onCancel={closeTop}
              onSubmit={(values) => saveTier(tierEdit, values)}
            />
          )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <View style={[styles.pill, active ? styles.pillActive : styles.pillInactive]}>
      <Text style={[styles.pillText, active ? styles.pillTextActive : styles.pillTextInactive]}>
        {active ? 'Active' : 'Inactive'}
      </Text>
    </View>
  );
}

function ProductDetail({
  product,
  tiersVersion,
  busy,
  onBack,
  onEdit,
  onDeactivate,
  onReactivate,
  onEditTier,
}: {
  product: Product;
  tiersVersion: number;
  busy: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onEditTier: (tier: PriceTier) => void;
}) {
  const { data, loading, error, isStale, retry } = useDataFetch<PriceTier[]>(
    () => apiClient.request(`/admin/products/price-tiers?product_id=${product.id}`, 'GET', 'admin_action'),
    [product.id, tiersVersion],
    { refetchOnFocus: false }
  );
  const tiers = Array.isArray(data) ? data : [];

  const [quantityText, setQuantityText] = useState('');
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const quoteBusy = useRef(false);

  // A quote worked out against an old price or old bands is no longer true.
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
  }, [product.price, tiersVersion]);

  const checkPrice = async () => {
    if (quoteBusy.current) return;
    const quantity = parseQuantity(quantityText);
    if (quantity === null) {
      setQuote(null);
      setQuoteError('Enter a whole number of units, 1 or more.');
      return;
    }
    quoteBusy.current = true;
    setQuoting(true);
    setQuoteError(null);
    try {
      const result = await apiClient.request(
        `/admin/products/${product.id}/quote?quantity=${quantity}`,
        'GET',
        'admin_action'
      );
      setQuote(result as PriceQuote);
    } catch (err) {
      setQuote(null);
      setQuoteError(errorMessage(err, 'Could not work out the price. Please try again.'));
    } finally {
      quoteBusy.current = false;
      setQuoting(false);
    }
  };

  return (
    <View style={styles.flex}>
      <View style={styles.modalHeader}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={onBack}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Back to product list"
        >
          <Ionicons name="chevron-back" size={24} color={color.white} />
        </TouchableOpacity>
        <Text style={styles.modalTitle} numberOfLines={1}>Product details</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled">
        <View style={[styles.sheetCard, !product.is_active && styles.cardInactive]}>
          <View style={styles.cardTop}>
            <Text style={styles.detailName}>{product.name}</Text>
            <StatusPill active={product.is_active} />
          </View>
          <DetailRow label="Category" value={product.category} />
          <DetailRow label="SKU" value={product.sku_code} />
          <DetailRow label="List price" value={formatRupees(product.price)} />
          {!!product.description && <DetailRow label="Description" value={product.description} />}
          <Text style={styles.updated}>
            {product.updated_by_name
              ? `Last updated by ${product.updated_by_name} on ${formatDate(product.updated_at)}`
              : `Created ${formatDate(product.created_at)}`}
          </Text>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.outlineBtn, busy && styles.disabled]}
              onPress={onEdit}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${product.name}`}
            >
              <Ionicons name="pencil-outline" size={18} color={color.primary} />
              <Text style={styles.outlineBtnText}>Edit</Text>
            </TouchableOpacity>
            {product.is_active ? (
              <TouchableOpacity
                style={[styles.dangerBtn, busy && styles.disabled]}
                onPress={onDeactivate}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Deactivate ${product.name}`}
              >
                {busy ? (
                  <ActivityIndicator color={color.error} size="small" />
                ) : (
                  <>
                    <Ionicons name="trash-outline" size={18} color={color.error} />
                    <Text style={styles.dangerBtnText}>Deactivate</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.primaryBtnInline, busy && styles.disabled]}
                onPress={onReactivate}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Reactivate ${product.name}`}
              >
                {busy ? (
                  <ActivityIndicator color={color.white} size="small" />
                ) : (
                  <>
                    <Ionicons name="refresh-outline" size={18} color={color.white} />
                    <Text style={styles.primaryBtnText}>Reactivate</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Price bands</Text>
        <Text style={styles.sectionHint}>
          Different rates by quantity or dealer. When no band matches, the list price applies.
        </Text>
        {loading ? (
          <ActivityIndicator style={styles.sectionLoader} color={color.primary} />
        ) : error ? (
          <View style={styles.sheetCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.outlineBtn}
              onPress={retry}
              accessibilityRole="button"
              accessibilityLabel="Try loading price bands again"
            >
              <Text style={styles.outlineBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : isStale ? (
          <View style={styles.sheetCard}>
            <Text style={styles.errorText}>Could not refresh the price bands, so the ones shown may be out of date.</Text>
            <TouchableOpacity
              style={styles.outlineBtn}
              onPress={retry}
              accessibilityRole="button"
              accessibilityLabel="Try loading price bands again"
            >
              <Text style={styles.outlineBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : tiers.length === 0 ? (
          <View style={styles.sheetCard}>
            <Text style={styles.mutedText}>No price bands yet for this product.</Text>
          </View>
        ) : (
          tiers.map((t) => (
            <View key={t.id} style={styles.tierRow}>
              <View style={styles.flex}>
                <Text style={styles.tierBand}>{t.band_label}</Text>
                <Text style={styles.tierMeta}>
                  {t.dealer_name ? `For ${t.dealer_name}` : 'All dealers'}
                </Text>
                {!!t.note && <Text style={styles.tierMeta}>{t.note}</Text>}
              </View>
              <Text style={styles.tierPrice}>{formatRupees(t.price)}</Text>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => onEditTier(t)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Edit price band ${t.band_label}`}
              >
                <Ionicons name="pencil-outline" size={20} color={color.primary} />
              </TouchableOpacity>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Check a price</Text>
        <Text style={styles.sectionHint}>See what a quantity costs and which rate is used.</Text>
        <View style={styles.sheetCard}>
          <Text style={styles.fieldLabel}>Quantity (units)</Text>
          <View style={styles.quoteRow}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={quantityText}
              onChangeText={setQuantityText}
              keyboardType="number-pad"
              maxLength={10}
              placeholder="For example 25"
              placeholderTextColor={color.textMuted}
              accessibilityLabel="Quantity to check the price for"
              returnKeyType="done"
              onSubmitEditing={checkPrice}
            />
            <TouchableOpacity
              style={[styles.primaryBtnInline, styles.quoteBtn, quoting && styles.disabled]}
              onPress={checkPrice}
              disabled={quoting}
              accessibilityRole="button"
              accessibilityLabel="Check price"
            >
              {quoting ? <ActivityIndicator color={color.white} size="small" /> : <Text style={styles.primaryBtnText}>Check</Text>}
            </TouchableOpacity>
          </View>
          {!!quoteError && <Text style={styles.errorText}>{quoteError}</Text>}
          {quote && (
            <View style={styles.quoteResult}>
              <DetailRow label="Rate per unit" value={formatRupees(quote.unit_price)} />
              <DetailRow label={`Total for ${formatCount(quote.quantity)}`} value={formatRupees(quote.line_total)} />
              <DetailRow label="Rate used" value={quote.band_label ? `${quote.source_label}, ${quote.band_label}` : quote.source_label} />
              {!!quote.note && <DetailRow label="Note" value={quote.note} />}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ProductForm({
  initial,
  saving,
  serverError,
  onCancel,
  onSubmit,
}: {
  initial: Product | null;
  saving: boolean;
  serverError: string | null;
  onCancel: () => void;
  onSubmit: (values: ProductValues) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [sku, setSku] = useState(initial?.sku_code ?? '');
  const [priceText, setPriceText] = useState(initial ? String(initial.price) : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    if (saving) return;
    const n = name.trim();
    const c = category.trim();
    const s = sku.trim();
    if (!n || !c || !s || !priceText.trim()) {
      setLocalError('Name, category, SKU and price are all required.');
      return;
    }
    const price = parsePrice(priceText);
    if (price === null) {
      setLocalError('Price must be more than 0, with at most 2 decimal places.');
      return;
    }
    setLocalError(null);
    onSubmit({ name: n, category: c, sku_code: s, price, description: description.trim() });
  };

  const shownError = localError ?? serverError;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.modalHeader}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={onCancel}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Cancel and go back"
        >
          <Ionicons name="close" size={24} color={color.white} />
        </TouchableOpacity>
        <Text style={styles.modalTitle} numberOfLines={1}>{initial ? 'Edit product' : 'Add product'}</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX}
          placeholder="Product name"
          placeholderTextColor={color.textMuted}
          accessibilityLabel="Product name"
        />
        <Text style={styles.fieldLabel}>Category</Text>
        <TextInput
          style={styles.input}
          value={category}
          onChangeText={setCategory}
          maxLength={CATEGORY_MAX}
          placeholder="For example Fertilizer"
          placeholderTextColor={color.textMuted}
          accessibilityLabel="Product category"
        />
        <Text style={styles.fieldLabel}>SKU code</Text>
        <TextInput
          style={styles.input}
          value={sku}
          onChangeText={setSku}
          maxLength={SKU_MAX}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="Unique code"
          placeholderTextColor={color.textMuted}
          accessibilityLabel="SKU code"
        />
        <Text style={styles.fieldLabel}>List price (rupees)</Text>
        <TextInput
          style={styles.input}
          value={priceText}
          onChangeText={setPriceText}
          keyboardType="decimal-pad"
          maxLength={PRICE_MAX_INTEGER_DIGITS + 3}
          placeholder="0.00"
          placeholderTextColor={color.textMuted}
          accessibilityLabel="List price in rupees"
        />
        <Text style={styles.fieldLabel}>Description (optional)</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          multiline
          textAlignVertical="top"
          placeholder="Short description"
          placeholderTextColor={color.textMuted}
          accessibilityLabel="Product description"
        />
        {!!shownError && <Text style={styles.errorText}>{shownError}</Text>}
        <View style={styles.formActions}>
          <TouchableOpacity
            style={[styles.outlineBtn, styles.flex, saving && styles.disabled]}
            onPress={onCancel}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.outlineBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryBtnInline, styles.flex, saving && styles.disabled]}
            onPress={submit}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={initial ? 'Save changes' : 'Create product'}
          >
            {saving ? (
              <ActivityIndicator color={color.white} size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>{initial ? 'Save changes' : 'Create product'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function TierForm({
  tier,
  saving,
  serverError,
  onCancel,
  onSubmit,
}: {
  tier: PriceTier;
  saving: boolean;
  serverError: string | null;
  onCancel: () => void;
  onSubmit: (values: TierValues) => void;
}) {
  const [minText, setMinText] = useState(String(tier.min_quantity));
  const [maxText, setMaxText] = useState(tier.max_quantity === null ? '' : String(tier.max_quantity));
  const [priceText, setPriceText] = useState(String(Number(tier.price)));
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    if (saving) return;
    const min = parseQuantity(minText);
    if (min === null) {
      setLocalError('The smallest quantity must be a whole number, 1 or more.');
      return;
    }
    let max: number | null = null;
    if (maxText.trim()) {
      max = parseQuantity(maxText);
      if (max === null) {
        setLocalError('The largest quantity must be a whole number, or leave it blank for no upper limit.');
        return;
      }
      if (max < min) {
        setLocalError('The largest quantity cannot be less than the smallest.');
        return;
      }
    }
    const price = parsePrice(priceText);
    if (price === null) {
      setLocalError('Price must be more than 0, with at most 2 decimal places.');
      return;
    }
    setLocalError(null);
    onSubmit({ min_quantity: min, max_quantity: max, price });
  };

  const shownError = localError ?? serverError;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.modalHeader}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={onCancel}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Cancel and go back"
        >
          <Ionicons name="close" size={24} color={color.white} />
        </TouchableOpacity>
        <Text style={styles.modalTitle} numberOfLines={1}>Edit price band</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.detailName}>{tier.product_name ?? 'Product'}</Text>
        <Text style={styles.sectionHint}>
          {tier.dealer_name ? `Band for ${tier.dealer_name}` : 'Band for all dealers'}
        </Text>
        <Text style={styles.fieldLabel}>Smallest quantity</Text>
        <TextInput
          style={styles.input}
          value={minText}
          onChangeText={setMinText}
          keyboardType="number-pad"
          maxLength={10}
          accessibilityLabel="Smallest quantity in this band"
        />
        <Text style={styles.fieldLabel}>Largest quantity (blank for no upper limit)</Text>
        <TextInput
          style={styles.input}
          value={maxText}
          onChangeText={setMaxText}
          keyboardType="number-pad"
          maxLength={10}
          placeholder="No upper limit"
          placeholderTextColor={color.textMuted}
          accessibilityLabel="Largest quantity in this band, blank for no upper limit"
        />
        <Text style={styles.fieldLabel}>Price per unit (rupees)</Text>
        <TextInput
          style={styles.input}
          value={priceText}
          onChangeText={setPriceText}
          keyboardType="decimal-pad"
          maxLength={PRICE_MAX_INTEGER_DIGITS + 3}
          accessibilityLabel="Price per unit in rupees"
        />
        {!!shownError && <Text style={styles.errorText}>{shownError}</Text>}
        <View style={styles.formActions}>
          <TouchableOpacity
            style={[styles.outlineBtn, styles.flex, saving && styles.disabled]}
            onPress={onCancel}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.outlineBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryBtnInline, styles.flex, saving && styles.disabled]}
            onPress={submit}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Save price band"
          >
            {saving ? <ActivityIndicator color={color.white} size="small" /> : <Text style={styles.primaryBtnText}>Save band</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hidden: { display: 'none' },
  disabled: { opacity: 0.5 },
  container: { flex: 1, backgroundColor: color.screenBg },
  toolbar: { padding: spacing.lg, paddingBottom: spacing.sm },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingLeft: spacing.md,
    minHeight: MIN_TOUCH,
  },
  searchInput: { flex: 1, fontSize: font.body, color: color.textPrimary, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, minHeight: MIN_TOUCH },
  clearBtn: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  toggle: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH },
  toggleText: { fontSize: font.body, color: color.textPrimary, marginLeft: spacing.sm },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    minHeight: MIN_TOUCH,
  },
  addBtnText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.body, marginLeft: spacing.xs },
  listContent: { padding: spacing.lg, paddingTop: spacing.sm },
  countText: { fontSize: font.caption, color: color.textSecondary, marginBottom: spacing.sm },
  noMatch: { fontSize: font.body, color: color.textSecondary, textAlign: 'center', marginTop: spacing.xxl },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    minHeight: MIN_TOUCH,
  },
  cardInactive: { opacity: 0.6 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  name: { flex: 1, fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginRight: spacing.sm },
  meta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  price: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.primary },
  pill: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  pillActive: { backgroundColor: color.success },
  pillInactive: { backgroundColor: color.borderLight },
  pillText: { fontSize: font.caption, fontWeight: fontWeight.semibold },
  pillTextActive: { color: color.white },
  pillTextInactive: { color: color.textSecondary },
  modalRoot: { flex: 1, backgroundColor: color.primary },
  modalInner: { flex: 1, backgroundColor: color.screenBg },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.primary,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerBtn: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { flex: 1, textAlign: 'center', color: color.white, fontSize: font.subtitle, fontWeight: fontWeight.bold },
  detailContent: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  sheetCard: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  detailName: { flex: 1, fontSize: font.title, fontWeight: fontWeight.bold, color: color.textPrimary, marginRight: spacing.sm, marginBottom: spacing.sm },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs + 2 },
  detailLabel: { fontSize: font.body, color: color.textSecondary, marginRight: spacing.md },
  detailValue: { flex: 1, fontSize: font.body, color: color.textPrimary, textAlign: 'right' },
  updated: { fontSize: font.caption, color: color.textMuted, marginTop: spacing.sm },
  actionRow: { flexDirection: 'row', marginTop: spacing.lg },
  outlineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.primary,
    borderRadius: radius.sm,
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.lg,
    marginRight: spacing.sm,
  },
  outlineBtnText: { color: color.primary, fontWeight: fontWeight.bold, fontSize: font.body, marginLeft: spacing.xs },
  dangerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.error,
    borderRadius: radius.sm,
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.lg,
  },
  dangerBtnText: { color: color.error, fontWeight: fontWeight.bold, fontSize: font.body, marginLeft: spacing.xs },
  primaryBtnInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.lg,
  },
  primaryBtnText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.body, marginLeft: spacing.xs },
  sectionTitle: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginTop: spacing.lg },
  sectionHint: { fontSize: font.caption, color: color.textSecondary, marginTop: 2, marginBottom: spacing.md },
  sectionLoader: { marginVertical: spacing.lg },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    marginBottom: spacing.sm,
    minHeight: MIN_TOUCH + spacing.md,
  },
  tierBand: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  tierMeta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  tierPrice: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.primary, marginHorizontal: spacing.sm },
  iconBtn: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  mutedText: { fontSize: font.body, color: color.textSecondary },
  errorText: { fontSize: font.body, color: color.error, marginVertical: spacing.sm },
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
  multiline: { minHeight: 96, paddingTop: spacing.md },
  quoteRow: { flexDirection: 'row', alignItems: 'center' },
  quoteBtn: { marginLeft: spacing.sm },
  quoteResult: { marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: color.borderLight },
  formActions: { flexDirection: 'row', marginTop: spacing.xl },
});
