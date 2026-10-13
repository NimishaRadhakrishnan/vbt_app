import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { apiClient } from '../services/api';
import PickerField from './PickerField';
import { color, font, fontWeight, spacing, radius } from '../theme';

// "Stock left in the dealer's shop": the dropdown version of the company
// stock sheet. Every pack size is already its own row in the products
// table, named like "V-NITRO (Liquid 5 Lit)", so Category > Product >
// Properties > Pack just split that name and the admin keeps managing one
// product list on the web.

type CatalogProduct = { id: string; name: string; category: string };
export type StockLine = { product_id: string; quantity_left: number };
type Parsed = { id: string; category: string; base: string; props: string; pack: string };

const parseProduct = (p: CatalogProduct): Parsed => {
  const m = p.name.match(/^(.*?)\s*\((.*)\)\s*$/);
  const base = (m?.[1] ?? p.name).trim();
  const variant = (m?.[2] ?? '').trim();
  const v = variant.match(/^([A-Za-z]+)\s+(\d.*)$/);
  return {
    id: p.id,
    category: p.category || 'Other',
    base,
    props: v?.[1] ?? 'Standard',
    pack: v?.[2] ?? (variant || 'Single pack'),
  };
};

type Row = { key: number; category: string; base: string; props: string; productId: string; qty: string };
const opt = (v: string) => ({ value: v, label: v });

export default function DealerStockSheet({
  onChange,
}: {
  onChange: (lines: StockLine[], problem: string | null) => void;
}) {
  const [catalog, setCatalog] = useState<Parsed[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [nextKey, setNextKey] = useState(1);

  useEffect(() => {
    apiClient
      .request('/dealers/products/catalog', 'GET', 'stock_audit')
      .then((d: any) => setCatalog(((d || []) as CatalogProduct[]).map(parseProduct)))
      .catch(() => setLoadError(true));
  }, []);

  const categories = useMemo(() => Array.from(new Set(catalog.map((c) => c.category))).sort(), [catalog]);
  const bases = (cat: string) =>
    Array.from(new Set(catalog.filter((c) => c.category === cat).map((c) => c.base))).sort();
  const propsFor = (cat: string, base: string) =>
    Array.from(new Set(catalog.filter((c) => c.category === cat && c.base === base).map((c) => c.props)));
  const packsFor = (cat: string, base: string, props: string) =>
    catalog.filter((c) => c.category === cat && c.base === base && c.props === props);

  useEffect(() => {
    const lines: StockLine[] = [];
    const seen = new Set<string>();
    let problem: string | null = null;
    for (const r of rows) {
      if (!r.productId && r.qty === '') continue;
      if (!r.productId) { problem = 'Pick the product pack in every stock sheet row.'; break; }
      if (r.qty === '' || Number.isNaN(Number(r.qty)) || Number(r.qty) < 0) {
        problem = 'Enter the quantity left (0 if none) in every stock sheet row.'; break;
      }
      if (seen.has(r.productId)) { problem = 'The same product pack is listed twice in the stock sheet.'; break; }
      seen.add(r.productId);
      lines.push({ product_id: r.productId, quantity_left: Math.floor(Number(r.qty)) });
    }
    onChange(problem ? [] : lines, problem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const addRow = () => {
    setRows((r) => [...r, { key: nextKey, category: '', base: '', props: '', productId: '', qty: '' }]);
    setNextKey((k) => k + 1);
  };
  const patch = (key: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));

  const pickBase = (key: number, cat: string, base: string) => {
    const props = propsFor(cat, base);
    const only = props.length === 1 ? (props[0] ?? '') : '';
    const packs = only ? packsFor(cat, base, only) : [];
    patch(key, { base, props: only, productId: packs.length === 1 ? (packs[0]?.id ?? '') : '' });
  };
  const pickProps = (key: number, cat: string, base: string, props: string) => {
    const packs = packsFor(cat, base, props);
    patch(key, { props, productId: packs.length === 1 ? (packs[0]?.id ?? '') : '' });
  };

  return (
    <View>
      {loadError && (
        <Text style={styles.warn}>Couldn&apos;t load the product list. You can still submit without the stock sheet.</Text>
      )}
      {rows.length === 0 && (
        <Text style={styles.hint}>Add each product you saw in the dealer&apos;s shop and the quantity still left there.</Text>
      )}
      {rows.map((r) => (
        <View key={r.key} style={styles.card}>
          <PickerField label="Category" anyLabel="Select" value={r.category}
            options={categories.map(opt)}
            onChange={(v) => patch(r.key, { category: v, base: '', props: '', productId: '' })} />
          {!!r.category && (
            <PickerField label="Product" anyLabel="Select" value={r.base}
              options={bases(r.category).map(opt)}
              onChange={(v) => pickBase(r.key, r.category, v)} />
          )}
          {!!r.base && (
            <PickerField label="Properties" anyLabel="Select" value={r.props}
              options={propsFor(r.category, r.base).map(opt)}
              onChange={(v) => pickProps(r.key, r.category, r.base, v)} />
          )}
          {!!r.props && (
            <PickerField label="Pack size" anyLabel="Select" value={r.productId}
              options={packsFor(r.category, r.base, r.props).map((p) => ({ value: p.id, label: p.pack }))}
              onChange={(v) => patch(r.key, { productId: v })} />
          )}
          <Text style={styles.label}>Quantity left in shop</Text>
          <TextInput style={styles.input} keyboardType="number-pad" placeholder="0" value={r.qty}
            onChangeText={(t) => patch(r.key, { qty: t.replace(/[^0-9]/g, '') })} />
          <TouchableOpacity onPress={() => remove(r.key)} style={styles.remove}>
            <Text style={styles.removeText}>Remove</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity onPress={addRow} style={styles.add} activeOpacity={0.7}>
        <Text style={styles.addText}>+ Add product</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  warn: { fontSize: font.caption, color: color.warningText, marginBottom: spacing.sm },
  hint: { fontSize: font.caption, color: color.textMuted, marginBottom: spacing.sm },
  card: {
    borderWidth: 1, borderColor: color.border, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.md, backgroundColor: color.cardBg,
  },
  label: { fontSize: font.caption, color: color.textMuted, marginTop: spacing.sm, marginBottom: spacing.xs },
  input: {
    borderWidth: 1, borderColor: color.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.body, color: color.textPrimary,
  },
  remove: { alignSelf: 'flex-end', marginTop: spacing.sm },
  removeText: { color: color.error, fontWeight: fontWeight.semibold, fontSize: font.caption },
  add: {
    borderWidth: 1, borderColor: color.primary, borderRadius: radius.md,
    paddingVertical: spacing.sm, alignItems: 'center',
  },
  addText: { color: color.primary, fontWeight: fontWeight.semibold, fontSize: font.body },
});
