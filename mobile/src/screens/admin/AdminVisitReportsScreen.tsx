import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../services/api';
import { ErrorState, EmptyState, LoadingState } from '../../components/FetchStates';
import PickerField, { PickerOption } from '../../components/PickerField';
import { asList } from '../../utils/lists';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type VisitListItem = {
  visit_id: string;
  visit_date: string;
  officer_name: string;
  employee_id: string | null;
  district: string | null;
  village: string | null;
  farmer_name: string | null;
  crop_name: string | null;
  crop_status: string | null;
  is_trial: boolean;
  demo_status: string | null;
  purchased: boolean | null;
  conversion_status: string | null;
  order_value: number | null;
};

type Filters = {
  date_from: string;
  date_to: string;
  district: string;
  village: string;
  farming_type: string;
  crop_status: string;
  is_trial: string;
  conversion_status: string;
  officer_id: string;
  employee_id: string;
  manager_id: string;
  crop_category_id: string;
  crop_id: string;
  pest_id: string;
  disease_id: string;
  demo_status: string;
  product_id: string;
  order_value_min: string;
  order_value_max: string;
};

const EMPTY: Filters = {
  date_from: '', date_to: '', district: '', village: '', farming_type: '', crop_status: '', is_trial: '',
  conversion_status: '', officer_id: '', employee_id: '', manager_id: '', crop_category_id: '', crop_id: '',
  pest_id: '', disease_id: '', demo_status: '', product_id: '', order_value_min: '', order_value_max: '',
};

const FARMING_TYPE: PickerOption[] = [
  { value: 'certified_organic', label: 'Certified Organic' },
  { value: 'natural_farming', label: 'Natural Farming' },
  { value: 'transitioning', label: 'Transitioning' },
  { value: 'conventional', label: 'Conventional' },
];
const CROP_STATUS: PickerOption[] = [
  { value: 'healthy', label: 'Healthy' },
  { value: 'mild_stress', label: 'Mild Stress' },
  { value: 'pest_disease_affected', label: 'Pest/Disease Affected' },
  { value: 'drought', label: 'Drought' },
  { value: 'waterlogged', label: 'Waterlogged' },
];
const DEMO_STATUS: PickerOption[] = [
  { value: 'agreed', label: 'Agreed' },
  { value: 'started_today', label: 'Started Today' },
  { value: 'running', label: 'Running' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
  { value: 'converted', label: 'Converted' },
];
const CONVERSION: PickerOption[] = [
  { value: 'interested', label: 'Interested' },
  { value: 'order_placed', label: 'Order Placed' },
  { value: 'converted', label: 'Converted' },
];
const TRIAL: PickerOption[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

const labelOf = (list: PickerOption[], v: string | null) => list.find((o) => o.value === v)?.label ?? v ?? '';

const PAGE = 25;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const istDay = (offsetDays = 0) => {
  const t = new Date(Date.now() + 5.5 * 3600_000 + offsetDays * 86400_000);
  return t.toISOString().slice(0, 10);
};

type Lists = {
  officers: PickerOption[];
  managers: PickerOption[];
  categories: PickerOption[];
  crops: (PickerOption & { category: string })[];
  pests: PickerOption[];
  diseases: PickerOption[];
  products: PickerOption[];
};

const NO_LISTS: Lists = { officers: [], managers: [], categories: [], crops: [], pests: [], diseases: [], products: [] };

const toOptions = (rows: any[]): PickerOption[] => rows.map((r) => ({ value: String(r.id), label: String(r.name) }));
const quiet = (path: string) => apiClient.request(path, 'GET', 'admin_action').then((r) => asList<any>(r)).catch(() => []);

// Every officer's Daily Visit Tracker submissions, with the same filters,
// search and list columns as the web "Daily Visit Reports" page. Tap a visit
// for the full report.
export default function AdminVisitReportsScreen({ navigation }: any) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [showFilters, setShowFilters] = useState(false);
  const [lists, setLists] = useState<Lists>(NO_LISTS);
  const listsLoaded = useRef(false);

  const [items, setItems] = useState<VisitListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const buildQuery = (f: Filters, q: string, offset: number) => {
    const params: string[] = [];
    (Object.keys(f) as (keyof Filters)[]).forEach((k) => {
      const v = f[k].trim();
      if (!v) return;
      if ((k === 'date_from' || k === 'date_to') && !DATE_RE.test(v)) return;
      params.push(`${k}=${encodeURIComponent(v)}`);
    });
    if (q.trim()) params.push(`q=${encodeURIComponent(q.trim())}`);
    params.push(`limit=${PAGE}`, `offset=${offset}`);
    return params.join('&');
  };

  const load = useCallback(
    async (mode: 'first' | 'refresh' | 'more') => {
      const id = ++requestId.current;
      const offset = mode === 'more' ? items.length : 0;
      if (mode === 'first') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      if (mode === 'more') setLoadingMore(true);
      try {
        const res: any = await apiClient.request(`/admin/daily-visits?${buildQuery(applied, query, offset)}`, 'GET', 'admin_action');
        if (id !== requestId.current) return; // a newer search replaced this one
        const rows = asList<VisitListItem>(res);
        setItems((prev) => (mode === 'more' ? [...prev, ...rows] : rows));
        setTotal(typeof res?.total === 'number' ? res.total : rows.length);
        setError(null);
      } catch (err: any) {
        if (id !== requestId.current) return;
        // A failed "load more" just stops paging; a failed first load shows the message.
        if (mode !== 'more') setError(err?.message ?? "Couldn't load visit reports.");
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applied, query, items.length],
  );

  // New filters or search: start again from the top.
  useEffect(() => {
    load('first');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, query]);

  // The lists behind the filter dropdowns are fetched the first time the panel opens.
  const openFilters = () => {
    setShowFilters((s) => !s);
    if (listsLoaded.current) return;
    listsLoaded.current = true;
    Promise.all([
      quiet('/users?limit=200'),
      quiet('/master-data/crop-categories'),
      quiet('/master-data/crops'),
      quiet('/master-data/pests'),
      quiet('/master-data/diseases'),
      quiet('/dealers/products/catalog'),
    ]).then(([users, categories, crops, pests, diseases, products]) => {
      setLists({
        officers: users
          .filter((u) => u.role === 'field_officer' || u.role === 'sales_officer')
          .map((u) => ({ value: String(u.id), label: `${u.full_name}${u.employee_id ? ` (${u.employee_id})` : ''}` })),
        managers: users.filter((u) => u.role === 'manager').map((u) => ({ value: String(u.id), label: String(u.full_name) })),
        categories: toOptions(categories),
        crops: crops.map((c) => ({ value: String(c.id), label: String(c.name), category: String(c.crop_category_id ?? '') })),
        pests: toOptions(pests),
        diseases: toOptions(diseases),
        products: toOptions(products),
      });
    });
  };

  const set = (k: keyof Filters) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const apply = () => {
    setApplied(draft);
    setShowFilters(false);
  };
  const clear = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
    setSearch('');
    setQuery('');
  };
  const preset = (from: string, to: string) => setDraft((d) => ({ ...d, date_from: from, date_to: to }));

  const activeCount = (Object.keys(applied) as (keyof Filters)[]).filter((k) => applied[k].trim()).length;
  const cropsShown = lists.crops.filter((c) => !draft.crop_category_id || c.category === draft.crop_category_id);

  const header = (
    <View>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search farmer, phone, officer, crop, village, product"
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => setQuery(search.trim())}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.iconBtn} onPress={() => setQuery(search.trim())} accessibilityLabel="Search">
          <Ionicons name="search" size={20} color={color.white} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.iconBtn, styles.filterBtn]} onPress={openFilters} accessibilityLabel="Filters">
          <Ionicons name="options-outline" size={20} color={color.primary} />
          {activeCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{activeCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {showFilters && (
        <View style={styles.panel}>
          <Text style={styles.panelLabel}>Date</Text>
          <View style={styles.presetRow}>
            <Chip label="Today" onPress={() => preset(istDay(), istDay())} />
            <Chip label="Last 7 days" onPress={() => preset(istDay(-6), istDay())} />
            <Chip label="This month" onPress={() => preset(`${istDay().slice(0, 8)}01`, istDay())} />
            <Chip label="All" onPress={() => preset('', '')} />
          </View>
          <View style={styles.grid}>
            <TextBox label="From (YYYY-MM-DD)" value={draft.date_from} onChange={set('date_from')} />
            <TextBox label="To (YYYY-MM-DD)" value={draft.date_to} onChange={set('date_to')} />
            <PickerField label="Field officer" value={draft.officer_id} options={lists.officers} onChange={set('officer_id')} />
            <PickerField label="Manager" value={draft.manager_id} options={lists.managers} onChange={set('manager_id')} />
            <TextBox label="Employee ID" value={draft.employee_id} onChange={set('employee_id')} />
            <TextBox label="District / Region" value={draft.district} onChange={set('district')} />
            <TextBox label="Village / Block" value={draft.village} onChange={set('village')} />
            <PickerField label="Farming type" value={draft.farming_type} options={FARMING_TYPE} onChange={set('farming_type')} />
            <PickerField
              label="Crop category"
              value={draft.crop_category_id}
              options={lists.categories}
              onChange={(v) => setDraft((d) => ({ ...d, crop_category_id: v, crop_id: '' }))}
            />
            <PickerField label="Crop" value={draft.crop_id} options={cropsShown} onChange={set('crop_id')} />
            <PickerField label="Crop health" value={draft.crop_status} options={CROP_STATUS} onChange={set('crop_status')} />
            <PickerField label="Pest" value={draft.pest_id} options={lists.pests} onChange={set('pest_id')} />
            <PickerField label="Disease" value={draft.disease_id} options={lists.diseases} onChange={set('disease_id')} />
            <PickerField label="Trial" value={draft.is_trial} options={TRIAL} onChange={set('is_trial')} />
            <PickerField label="Demo status" value={draft.demo_status} options={DEMO_STATUS} onChange={set('demo_status')} />
            <PickerField label="Product" value={draft.product_id} options={lists.products} onChange={set('product_id')} />
            <PickerField label="Sales conversion" value={draft.conversion_status} options={CONVERSION} onChange={set('conversion_status')} />
            <TextBox label="Order value min (₹)" value={draft.order_value_min} onChange={set('order_value_min')} numeric />
            <TextBox label="Order value max (₹)" value={draft.order_value_max} onChange={set('order_value_max')} numeric />
          </View>
          <View style={styles.panelButtons}>
            <TouchableOpacity style={styles.applyBtn} onPress={apply}>
              <Text style={styles.applyText}>Apply filters</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.clearBtn} onPress={clear}>
              <Text style={styles.clearText}>Clear all</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {!loading && !error && (
        <Text style={styles.count}>
          {total} visit{total === 1 ? '' : 's'}
          {activeCount > 0 || query ? ' match' : ''}
        </Text>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={loading || error ? [] : items}
        keyExtractor={(v) => v.visit_id}
        contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} onRetry={() => load('first')} />
          ) : (
            <EmptyState message="No visits match." actionHint="Try clearing a filter or the search." />
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={color.primary} style={{ marginVertical: spacing.lg }} /> : null}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (!loading && !loadingMore && !error && items.length < total) load('more');
        }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('AdminVisitDetail', { visitId: item.visit_id })}
          >
            <View style={styles.cardHead}>
              <Text style={styles.name} numberOfLines={1}>{item.farmer_name ?? 'Unnamed farmer'}</Text>
              <Text style={styles.date}>{item.visit_date}</Text>
            </View>
            <Text style={styles.meta}>
              {item.officer_name}{item.employee_id ? ` (${item.employee_id})` : ''}
            </Text>
            {(!!item.village || !!item.district) && (
              <Text style={styles.meta}>{[item.village, item.district].filter(Boolean).join(', ')}</Text>
            )}
            <View style={styles.tags}>
              {!!item.crop_name && <Tag text={item.crop_name} />}
              {!!item.crop_status && <Tag text={labelOf(CROP_STATUS, item.crop_status)} warn={item.crop_status !== 'healthy'} />}
              {item.is_trial && <Tag text={`Trial${item.demo_status ? `: ${labelOf(DEMO_STATUS, item.demo_status)}` : ''}`} />}
              {!!item.purchased && (
                <Tag
                  good
                  text={`${labelOf(CONVERSION, item.conversion_status) || 'Sale'}${item.order_value ? ` · ₹${item.order_value}` : ''}`}
                />
              )}
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.chip} onPress={onPress}>
      <Text style={styles.chipText}>{label}</Text>
    </TouchableOpacity>
  );
}

function TextBox({ label, value, onChange, numeric }: { label: string; value: string; onChange: (v: string) => void; numeric?: boolean }) {
  return (
    <View style={styles.box}>
      <Text style={styles.boxLabel}>{label}</Text>
      <TextInput
        style={styles.boxInput}
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? 'numeric' : 'default'}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function Tag({ text, warn, good }: { text: string; warn?: boolean; good?: boolean }) {
  return <Text style={[styles.tag, warn && styles.tagWarn, good && styles.tagGood]}>{text}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  searchRow: { flexDirection: 'row', marginBottom: spacing.md },
  searchInput: {
    flex: 1,
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.body,
    marginRight: spacing.sm,
  },
  iconBtn: {
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    width: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
  },
  filterBtn: { backgroundColor: color.cardBg, borderWidth: 1, borderColor: color.primary },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: color.primary,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: color.white, fontSize: 11, fontWeight: fontWeight.bold },
  panel: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  panelLabel: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary, marginBottom: 6 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  chip: {
    borderWidth: 1,
    borderColor: color.primary,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
  },
  chipText: { fontSize: font.caption, color: color.primary, fontWeight: fontWeight.semibold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  box: { width: '48.5%', marginBottom: spacing.md },
  boxLabel: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary, marginBottom: 4 },
  boxInput: {
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: font.body,
    color: color.textPrimary,
  },
  panelButtons: { flexDirection: 'row', marginTop: spacing.xs },
  applyBtn: { backgroundColor: color.primary, borderRadius: radius.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  applyText: { color: color.white, fontWeight: fontWeight.bold },
  clearBtn: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  clearText: { color: color.primary, fontWeight: fontWeight.bold },
  count: { fontSize: font.caption, color: color.textSecondary, marginBottom: spacing.sm },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { flex: 1, fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginRight: spacing.sm },
  date: { fontSize: font.caption, color: color.textSecondary },
  meta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  tag: {
    fontSize: font.caption,
    color: color.textPrimary,
    backgroundColor: color.borderLight,
    borderRadius: 10,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  tagWarn: { backgroundColor: color.warningBg, color: color.warningText },
  tagGood: { backgroundColor: '#e8f5e9', color: color.success },
});
