import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { apiClient } from '../services/api';
import { takePhoto } from '../utils/camera';
import { color, font, fontWeight, spacing, radius } from '../theme';

export type OdoReading = { id: string; kind: string; km: number; is_late: boolean; created_at: string };

// Speedometer photo + the km shown on it. Once at check-in, once at check-out.
export default function OdometerCard({
  kind, existing, onSubmitted, required = false,
}: { kind: 'check_in' | 'check_out'; existing: OdoReading | null; onSubmitted: () => void; required?: boolean }) {
  const [uri, setUri] = useState<string | null>(null);
  const [km, setKm] = useState('');
  const [busy, setBusy] = useState(false);
  const morning = kind === 'check_in';

  if (existing) {
    const t = new Date(existing.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return (
      <View style={[styles.card, styles.done]}>
        <Text style={styles.doneTitle}>
          ✓ {morning ? 'Start-of-day' : 'End-of-day'} speedometer submitted
        </Text>
        <Text style={styles.sub}>{existing.km} km at {t}{existing.is_late ? ' (after 6 PM)' : ''}</Text>
      </View>
    );
  }

  const capture = async () => {
    const u = await takePhoto(0.7);
    if (u) setUri(u);
  };

  const submit = async () => {
    const value = parseFloat(km.replace(',', '.'));
    if (!uri) { Alert.alert('Photo needed', 'Take a clear photo of the speedometer first.'); return; }
    if (!isFinite(value) || value < 0) { Alert.alert('Enter the km', 'Type the km reading shown in the photo.'); return; }
    setBusy(true);
    try {
      await apiClient.uploadForm('/odometer', uri, `speedo-${kind}-${Date.now()}.jpg`, 'image/jpeg', { kind, km: String(value) });
      setUri(null);
      setKm('');
      onSubmitted();
    } catch (e: any) {
      Alert.alert('Not submitted', e?.message || 'Could not upload. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{morning ? 'Start of day: speedometer' : 'End of day: speedometer'}{required ? '' : ' (optional)'}</Text>
      <Text style={styles.sub}>
        {required
          ? (morning
            ? 'Take a photo of the speedometer and type the km shown. Needed before you clock in.'
            : 'Take a photo of the speedometer and type the km shown. Needed before you clock out (please do this before 6 PM).')
          : (morning
            ? 'Optional. Take a photo of the speedometer and type the km shown. You can clock in without it.'
            : 'Optional. Take a photo of the speedometer and type the km shown (before 6 PM). You can clock out without it.')}
      </Text>
      {uri ? <Image source={{ uri }} style={styles.preview} resizeMode="cover" /> : null}
      <TouchableOpacity style={styles.btnPhoto} onPress={capture} disabled={busy}>
        <Text style={styles.btnPhotoText}>{uri ? 'Retake photo' : 'Take speedometer photo'}</Text>
      </TouchableOpacity>
      <TextInput
        style={styles.input}
        value={km}
        onChangeText={setKm}
        placeholder="Km shown on speedometer"
        keyboardType="decimal-pad"
        editable={!busy}
      />
      <TouchableOpacity style={[styles.btnSubmit, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color={color.white} /> : <Text style={styles.btnSubmitText}>Submit reading</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.white, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: color.border, marginBottom: spacing.lg,
  },
  done: { borderColor: color.success },
  doneTitle: { fontSize: font.body, fontWeight: fontWeight.bold, color: color.success },
  title: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.primary },
  sub: { fontSize: font.body, color: color.textSecondary, marginTop: 4, marginBottom: spacing.sm },
  preview: { width: '100%', height: 160, borderRadius: radius.md, marginBottom: spacing.sm },
  btnPhoto: { borderWidth: 1, borderColor: color.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm },
  btnPhotoText: { color: color.primary, fontWeight: fontWeight.bold, fontSize: font.body },
  input: { borderWidth: 1, borderColor: color.border, borderRadius: radius.md, padding: spacing.md, fontSize: font.body, marginBottom: spacing.sm, color: color.textPrimary },
  btnSubmit: { backgroundColor: color.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  btnSubmitText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.body },
});
