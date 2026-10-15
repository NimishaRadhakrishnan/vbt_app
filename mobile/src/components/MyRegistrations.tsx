import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../services/api';
import { useDataFetch } from '../hooks/useDataFetch';
import { LoadingState, ErrorState } from './FetchStates';
import SearchBox, { matchesQuery } from './SearchBox';
import { color, font, fontWeight, spacing, radius } from '../theme';

// The officer's own registrations, newest first: farmers (GET /farmers/search
// is already limited to the ones this officer registered) or dealers
// (GET /dealers/search?mine=true, any status, so a dealer still waiting for
// approval is visible too).
const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: 'Approved', tone: color.success },
  pending_approval: { label: 'Waiting for approval', tone: '#b26a00' },
  rejected: { label: 'Rejected', tone: color.error },
};

const day = (s?: string) => (s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

export default function MyRegistrations({ kind }: { kind: 'farmer' | 'dealer' }) {
  const { data, loading, error, retry } = useDataFetch<any[]>(
    () => apiClient.request(kind === 'farmer' ? '/farmers/search?limit=300' : '/dealers/search?mine=true&limit=300', 'GET', 'stock_audit').then((d) => d || []),
    [kind]
  );
  const [query, setQuery] = useState('');

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;

  const rows = (data ?? []).filter((r) => matchesQuery(`${r.name} ${r.village ?? ''} ${r.district ?? ''} ${r.phone ?? ''} ${r.crop ?? ''}`, query));
  return (
    <View>
      <Text style={styles.count}>
        {(data ?? []).length} {kind === 'farmer' ? 'farmer' : 'dealer'}{(data ?? []).length === 1 ? '' : 's'} registered by you
      </Text>
      <SearchBox value={query} onChangeText={setQuery} placeholder={`Search your ${kind}s…`} />
      {rows.length === 0 && <Text style={styles.empty}>{(data ?? []).length === 0 ? `You have not registered any ${kind} yet.` : 'No match.'}</Text>}
      {rows.map((r) => {
        const st = STATUS[r.status];
        return (
          <View key={r.id} style={styles.card}>
            <View style={styles.top}>
              <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
              {kind === 'farmer' && !!r.crop && <Text style={styles.chip}>{r.crop}</Text>}
              {kind === 'dealer' && st && <Text style={[styles.chip, { color: st.tone, borderColor: st.tone }]}>{st.label}</Text>}
            </View>
            <Text style={styles.meta}>{[r.village, r.district].filter(Boolean).join(', ')}</Text>
            <Text style={styles.meta}>
              {r.phone}
              {kind === 'farmer' && r.cents ? ` · ${r.cents} cents` : ''}
              {kind === 'dealer' && r.contact_person ? ` · ${r.contact_person}` : ''}
            </Text>
            <Text style={styles.date}>Registered {day(r.created_at)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  count: { fontSize: font.caption, color: color.textMuted, marginBottom: spacing.sm },
  empty: { color: color.textMuted, fontStyle: 'italic', textAlign: 'center', marginVertical: spacing.xl },
  card: { backgroundColor: color.white, borderRadius: radius.md, borderWidth: 1, borderColor: color.border, padding: spacing.lg, marginTop: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { flex: 1, fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginRight: spacing.sm },
  chip: { fontSize: font.caption, fontWeight: fontWeight.bold, color: color.primary, borderWidth: 1, borderColor: color.primary, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 2, paddingRight: 12 },
  meta: { fontSize: font.body, color: color.textSecondary, marginTop: 3 },
  date: { fontSize: font.caption, color: color.textMuted, marginTop: 4 },
});
