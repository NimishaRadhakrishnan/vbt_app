import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { apiClient } from '../services/api';
import { showSubmitResult } from '../utils/offlineAlert';
import { color, font, fontWeight, spacing, radius } from '../theme';

export default function FarmerScreen({ navigation }: any) {
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
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

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
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Register Farmer Profile</Text>

      <View style={styles.form}>
        <TextInput style={styles.input} placeholder="Farmer Name" placeholderTextColor={color.textMuted} value={name} onChangeText={setName} />
        <TextInput style={styles.input} placeholder="Mobile Number" placeholderTextColor={color.textMuted} keyboardType="phone-pad" maxLength={10} value={phone} onChangeText={setPhone} />
        <TextInput style={styles.input} placeholder="Village Name" placeholderTextColor={color.textMuted} value={village} onChangeText={setVillage} />
        <TextInput style={styles.input} placeholder="Taluk" placeholderTextColor={color.textMuted} value={taluk} onChangeText={setTaluk} />
        <TextInput style={styles.input} placeholder="District" placeholderTextColor={color.textMuted} value={district} onChangeText={setDistrict} />
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

      <TouchableOpacity style={styles.btnBack} onPress={() => navigation.goBack()}>
        <Text style={styles.btnBackText}>Cancel & Go Back</Text>
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
