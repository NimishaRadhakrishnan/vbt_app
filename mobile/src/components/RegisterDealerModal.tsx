import React, { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { apiClient } from '../services/api';
import { showSubmitResult } from '../utils/offlineAlert';
import { useDistricts } from '../hooks/useDistricts';
import { ChipPicker } from '../screens/dailyVisitTracker/FormFields';
import { color, font, fontWeight, spacing, radius } from '../theme';

const DEFAULT_DISTRICTS = ['Dindigul', 'Tiruppur', 'Coimbatore', 'Erode', 'Salem'];
const DEALER_TYPES = ['Dealer', 'Distributor', 'Retailer'];

// Field officers register a new dealer here. It is saved as "pending
// approval" and shows in the admin web app (Field Network > Dealers) until
// an admin or manager approves it.
export default function RegisterDealerModal({ visible, onClose, onRegistered }: { visible: boolean; onClose: () => void; onRegistered?: () => void }) {
  const districts = useDistricts(DEFAULT_DISTRICTS);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [district, setDistrict] = useState<string | null>(null);
  const [village, setVillage] = useState('');
  const [contact, setContact] = useState('');
  const [address, setAddress] = useState('');
  const [gst, setGst] = useState('');
  const [dealerType, setDealerType] = useState<string | null>('Dealer');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName(''); setPhone(''); setDistrict(null); setVillage(''); setContact(''); setAddress(''); setGst(''); setRemarks(''); setError(null);
  };

  const submit = async (acknowledged = false) => {
    if (busy) return;
    const cleanPhone = phone.replace(/\s+/g, '');
    if (!name.trim()) return setError('Enter the dealer / shop name.');
    if (cleanPhone.length < 10) return setError('Enter a valid phone number (at least 10 digits).');
    if (!district) return setError('Choose the district.');
    setError(null);
    setBusy(true);
    try {
      if (!acknowledged) {
        try {
          const q = new URLSearchParams({ name: name.trim(), phone: cleanPhone, district });
          if (gst.trim()) q.set('gst_number', gst.trim());
          const dup: any = await apiClient.request(`/dealers/check-duplicate?${q.toString()}`, 'GET', 'stock_audit');
          if (dup?.has_possible_duplicates) {
            const list = dup.candidates.map((c: any) => `${c.name} (${c.phone})`).join('\n');
            setBusy(false);
            Alert.alert('Dealer may already exist', `${list}\n\nRegister anyway?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Register anyway', onPress: () => void submit(true) },
            ]);
            return;
          }
        } catch {
          // Offline or lookup failed: the server re-checks on save.
        }
      }
      const res = await apiClient.request('/dealers/', 'POST', 'stock_audit', {
        name: name.trim(),
        phone: cleanPhone,
        district,
        village: village.trim() || null,
        contact_person: contact.trim() || null,
        address: address.trim() || null,
        gst_number: gst.trim() || null,
        dealer_type: dealerType,
        remarks: remarks.trim() || null,
        duplicate_check_acknowledged: acknowledged,
      });
      showSubmitResult(res, 'Dealer Registered', 'Sent for approval. It will appear in your dealer list once an admin approves it.');
      reset();
      onRegistered?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not register the dealer.');
    } finally {
      setBusy(false);
    }
  };

  const input = (label: string, value: string, set: (v: string) => void, extra: any = {}) => (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={set} placeholderTextColor={color.textMuted} {...extra} />
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Register Dealer</Text>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Close"><Text style={styles.close}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.xl }} keyboardShouldPersistTaps="handled">
          {error && <Text style={styles.error}>{error}</Text>}
          {input('Dealer / Shop Name *', name, setName, { placeholder: 'Shop name' })}
          {input('Phone Number *', phone, setPhone, { placeholder: '10-digit number', keyboardType: 'phone-pad', maxLength: 15 })}
          <Text style={styles.label}>District *</Text>
          <View style={{ marginBottom: spacing.md }}>
            <ChipPicker options={districts.map((d) => ({ value: d, label: d }))} value={district} onChange={setDistrict} />
          </View>
          {input('Village / Area', village, setVillage, { placeholder: 'Village or area' })}
          {input('Contact Person', contact, setContact, { placeholder: 'Owner / manager name' })}
          {input('Address', address, setAddress, { placeholder: 'Street, town', multiline: true })}
          {input('GST Number', gst, setGst, { placeholder: 'Optional', autoCapitalize: 'characters', maxLength: 20 })}
          <Text style={styles.label}>Type</Text>
          <View style={{ marginBottom: spacing.md }}>
            <ChipPicker options={DEALER_TYPES.map((d) => ({ value: d, label: d }))} value={dealerType} onChange={setDealerType} />
          </View>
          {input('Remarks', remarks, setRemarks, { placeholder: 'Optional', multiline: true, maxLength: 1000 })}
          <TouchableOpacity style={[styles.btn, busy && { opacity: 0.7 }]} onPress={() => void submit(false)} disabled={busy}>
            {busy ? <ActivityIndicator color={color.white} /> : <Text style={styles.btnText}>Register Dealer</Text>}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.xl, paddingTop: 40, backgroundColor: color.primary },
  title: { color: color.white, fontSize: font.title, fontWeight: fontWeight.bold },
  close: { color: color.white, fontSize: 22 },
  label: { color: color.textSecondary, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, backgroundColor: color.white, padding: 12, color: color.textPrimary },
  error: { color: color.error, fontWeight: fontWeight.bold, marginBottom: spacing.md },
  btn: { backgroundColor: color.primary, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', marginTop: spacing.md, marginBottom: 40 },
  btnText: { color: color.white, fontSize: font.title, fontWeight: fontWeight.bold },
});
