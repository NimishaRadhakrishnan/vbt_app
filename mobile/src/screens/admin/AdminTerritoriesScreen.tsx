import React, { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState, StaleDataBanner } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type Territory = {
  id: string;
  name: string;
  district: string;
  center_lat: number | null;
  center_lng: number | null;
  radius_m: number | null;
  officers: number;
};

// Admin sets, per territory, a circle (centre + radius). An officer assigned
// to a territory raises an alert when they are outside every assigned circle
// during working hours. A territory with no circle is simply not checked.
export default function AdminTerritoriesScreen() {
  const { data, loading, error, isStale, retry, refresh } = useDataFetch<Territory[]>(
    () => apiClient.request('/location/territories', 'GET', 'admin_action'),
    [],
  );
  const [editing, setEditing] = useState<string | null>(null);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={Array.isArray(data) ? data : []}
        keyExtractor={(t) => t.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
        ListHeaderComponent={isStale ? <StaleDataBanner onRetry={retry} /> : null}
        ListEmptyComponent={<EmptyState message="No territories yet." actionHint="Territories are created with the officer's assignment." />}
        renderItem={({ item }) => (
          <TerritoryCard
            t={item}
            open={editing === item.id}
            onToggle={() => setEditing(editing === item.id ? null : item.id)}
            onSaved={() => { setEditing(null); refresh(); }}
          />
        )}
      />
    </KeyboardAvoidingView>
  );
}

function TerritoryCard({ t, open, onToggle, onSaved }: { t: Territory; open: boolean; onToggle: () => void; onSaved: () => void }) {
  const [lat, setLat] = useState(t.center_lat != null ? String(t.center_lat) : '');
  const [lng, setLng] = useState(t.center_lng != null ? String(t.center_lng) : '');
  const [km, setKm] = useState(t.radius_m != null ? String(Math.round((t.radius_m / 1000) * 10) / 10) : '');
  const [busy, setBusy] = useState(false);

  const useMyLocation = async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Location needed', 'Allow location to use your current position.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLat(pos.coords.latitude.toFixed(5));
      setLng(pos.coords.longitude.toFixed(5));
    } catch {
      Alert.alert('Could not get your location', 'Try again, or type the coordinates.');
    }
  };

  const save = async () => {
    const num = (v: string) => (v.trim() ? Number(v.trim().replace(',', '.')) : NaN);
    const la = num(lat);
    const lo = num(lng);
    const r = Math.round(num(km) * 1000);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || !Number.isFinite(r)) {
      Alert.alert('Check the numbers', 'Enter a latitude, a longitude and a radius in km.');
      return;
    }
    if (la < -90 || la > 90 || lo < -180 || lo > 180) {
      Alert.alert('Check the numbers', 'That latitude or longitude is not on Earth.');
      return;
    }
    if (r < 100 || r > 200000) {
      Alert.alert('Check the radius', 'Use a radius between 0.1 km and 200 km.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiClient.request(`/location/territories/${t.id}/geofence`, 'PUT', 'admin_action', { center_lat: la, center_lng: lo, radius_m: r });
      if (res?.offline) Alert.alert('Offline', 'Saved on this phone. It will be sent when you are back online.');
      onSaved();
    } catch (err: any) {
      Alert.alert('Not saved', err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    Alert.alert('Remove this area?', `${t.name} will no longer be checked.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const res = await apiClient.request(`/location/territories/${t.id}/geofence`, 'DELETE', 'admin_action');
            if (res?.offline) {
              Alert.alert('Offline', 'Saved on this phone. The area is removed when you are back online.');
            } else {
              setLat(''); setLng(''); setKm('');
            }
            onSaved();
          } catch (err: any) {
            Alert.alert('Not removed', err?.message ?? 'Please try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const hasFence = t.radius_m != null && t.center_lat != null;
  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={onToggle} accessibilityRole="button" accessibilityLabel={`${t.name}, ${open ? 'close' : 'edit'} area`}>
        <Text style={styles.name}>{t.name}</Text>
        <Text style={styles.meta}>{t.district} · {t.officers} officer{t.officers === 1 ? '' : 's'}</Text>
        <Text style={hasFence ? styles.on : styles.off}>
          {hasFence ? `Alert if outside ${(t.radius_m! / 1000).toFixed(1)} km of ${t.center_lat!.toFixed(4)}, ${t.center_lng!.toFixed(4)}` : 'No area set: not checked'}
        </Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.form}>
          <TouchableOpacity style={styles.ghost} onPress={useMyLocation} accessibilityRole="button">
            <Text style={styles.ghostText}>Use my current location as the centre</Text>
          </TouchableOpacity>
          <Field label="Latitude" value={lat} onChange={setLat} />
          <Field label="Longitude" value={lng} onChange={setLng} />
          <Field label="Radius (km)" value={km} onChange={setKm} />
          <View style={styles.actions}>
            <TouchableOpacity style={styles.save} disabled={busy} onPress={save} accessibilityRole="button">
              {busy ? <ActivityIndicator color={color.white} size="small" /> : <Text style={styles.saveText}>Save area</Text>}
            </TouchableOpacity>
            {hasFence && (
              <TouchableOpacity style={styles.remove} disabled={busy} onPress={clear} accessibilityRole="button">
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  card: { backgroundColor: color.cardBg, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  name: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  meta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  on: { fontSize: font.caption, color: color.success, marginTop: spacing.sm },
  off: { fontSize: font.caption, color: color.textSecondary, marginTop: spacing.sm, fontStyle: 'italic' },
  form: { marginTop: spacing.md },
  label: { fontSize: font.caption, color: color.textSecondary, marginBottom: 4 },
  input: { minHeight: 44, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, color: color.textPrimary, backgroundColor: color.white },
  ghost: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: color.primary, borderRadius: radius.sm },
  ghostText: { color: color.primary, fontWeight: fontWeight.semibold, fontSize: font.caption },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  save: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: color.primary, borderRadius: radius.sm },
  saveText: { color: color.white, fontWeight: fontWeight.bold },
  remove: { minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: color.error, borderRadius: radius.sm },
  removeText: { color: color.error, fontWeight: fontWeight.semibold },
});
