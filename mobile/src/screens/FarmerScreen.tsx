import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { apiClient } from '../services/api';
import { LocationService } from '../services/LocationService';
import { useDistricts } from '../hooks/useDistricts';
import { ChipPicker } from './dailyVisitTracker/FormFields';
import MyRegistrations from '../components/MyRegistrations';
import { showSubmitResult } from '../utils/offlineAlert';
import { color, font, fontWeight, spacing, radius } from '../theme';

const DEFAULT_DISTRICTS = ['Dindigul', 'Tiruppur', 'Coimbatore', 'Erode', 'Salem'];

export default function FarmerScreen({ navigation, embedded, onDone }: any) {
  const districts = useDistricts(DEFAULT_DISTRICTS);
  const [view, setView] = useState<'new' | 'mine'>('new');
  const [listKey, setListKey] = useState(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [village, setVillage] = useState('');
  const [taluk, setTaluk] = useState('');
  const [district, setDistrict] = useState('');
  const [crop, setCrop] = useState('');
  const [cents, setCents] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleRegister = async () => {
    if (!name || !phone || !village || !taluk || !district || !crop || !cents) {
      Alert.alert('Required Fields', 'Please fill in all the details.');
      return;
    }
    // Previously had no in-flight indicator at all - on a slow rural
    // connection nothing stopped a double-tap of Register from queuing
    // two registrations for the same farmer.
    setSubmitting(true);

    try {
      // Real device fix, real taluk/district (previously always hardcoded
      // to 'Mallasamudram'/'Namakkal' regardless of what the officer
      // actually typed, and every farmer landed at the same coordinates).
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location Required', 'Location permission is needed to register a farmer.');
        return;
      }
      const position = await LocationService.getFix();
      if (!position) {
        Alert.alert('No GPS signal', 'Could not get your location. Turn on GPS / Location and try again.');
        return;
      }

      const res = await apiClient.request('/farmers/', 'POST', 'farmer_register', {
        name,
        phone,
        village,
        taluk,
        district,
        crop,
        cents: parseFloat(cents),
        location_lat: position.coords.latitude,
        location_lng: position.coords.longitude,
      });

      showSubmitResult(res, 'Farmer Registered', `${name} successfully added to database.`);
      setName(''); setPhone(''); setVillage(''); setTaluk(''); setDistrict(''); setCrop(''); setCents('');
      setListKey((k) => k + 1);
      if (embedded) onDone?.();
      else navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{view === 'new' ? 'Register Farmer Profile' : 'My Farmers'}</Text>

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, view === 'new' && styles.tabActive]} onPress={() => setView('new')}>
          <Text style={[styles.tabText, view === 'new' && styles.tabTextActive]}>Register new</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, view === 'mine' && styles.tabActive]} onPress={() => setView('mine')}>
          <Text style={[styles.tabText, view === 'mine' && styles.tabTextActive]}>My farmers</Text>
        </TouchableOpacity>
      </View>

      {view === 'mine' && <MyRegistrations key={listKey} kind="farmer" />}

      {view === 'new' && (
      <View style={styles.form}>
        <TextInput style={styles.input} placeholder="Farmer Name" placeholderTextColor={color.textMuted} value={name} onChangeText={setName} />
        <TextInput style={styles.input} placeholder="Mobile Number" placeholderTextColor={color.textMuted} keyboardType="phone-pad" maxLength={10} value={phone} onChangeText={setPhone} />
        <TextInput style={styles.input} placeholder="Village Name" placeholderTextColor={color.textMuted} value={village} onChangeText={setVillage} />
        <TextInput style={styles.input} placeholder="Taluk" placeholderTextColor={color.textMuted} value={taluk} onChangeText={setTaluk} />
        <Text style={styles.fieldLabel}>District</Text>
        <ChipPicker options={districts.map((d) => ({ value: d, label: d }))} value={district || null} onChange={setDistrict} />
        <View style={{ height: spacing.lg }} />
        <TextInput style={styles.input} placeholder="Primary Crop (e.g. Paddy)" placeholderTextColor={color.textMuted} value={crop} onChangeText={setCrop} />
        <TextInput style={styles.input} placeholder="Cultivated Cents (e.g. 4.5)" placeholderTextColor={color.textMuted} keyboardType="numeric" value={cents} onChangeText={setCents} />
        <Text style={{ fontSize: 11, color: color.textMuted, marginBottom: 8 }}>1 acre = 100 cents</Text>

        <TouchableOpacity
          style={[styles.btnRegister, submitting && { opacity: 0.6 }]}
          onPress={handleRegister}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={color.white} />
          ) : (
            <Text style={styles.btnText}>Save Farmer Profile</Text>
          )}
        </TouchableOpacity>
      </View>
      )}

      {!embedded && (
        <TouchableOpacity style={styles.btnBack} onPress={() => navigation.goBack()}>
          <Text style={styles.btnBackText}>Cancel & Go Back</Text>
        </TouchableOpacity>
      )}
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
    marginBottom: spacing.xxl,
    marginTop: spacing.xl,
  },
  form: {
    backgroundColor: color.white,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: color.border,
  },
  tabs: { flexDirection: 'row', marginBottom: spacing.lg },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderWidth: 1, borderColor: color.border, backgroundColor: color.white },
  tabActive: { backgroundColor: color.primary, borderColor: color.primary },
  tabText: { fontSize: font.body, fontWeight: fontWeight.bold, color: color.textPrimary },
  tabTextActive: { color: color.white },
  fieldLabel: { fontSize: font.caption, fontWeight: fontWeight.bold, color: color.primary, marginBottom: 6, textTransform: 'uppercase' },
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
  btnRegister: {
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    padding: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  btnText: {
    color: color.white,
    fontWeight: fontWeight.bold,
    fontSize: font.subtitle,
  },
  btnBack: {
    padding: spacing.lg,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 40,
  },
  btnBackText: {
    color: color.primary,
    fontWeight: fontWeight.bold,
    fontSize: font.subtitle,
  },
});
