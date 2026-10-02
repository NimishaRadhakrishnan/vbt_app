import React, { useEffect } from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { apiClient } from '../services/api';
import { color, font, fontWeight, spacing } from '../theme';

export default function SplashScreen({ navigation }: any) {
  useEffect(() => {
    (async () => {
      // Go straight to where the person needs to be - no fixed delay.
      // Previously this always waited 2 seconds before showing Login,
      // even for a returning, already-signed-in officer - and even that
      // check only looked at the in-memory token, which never survives
      // a real app restart. restoreSession() reads the persisted session
      // from disk first so a genuinely returning officer lands on
      // Dashboard, not Login, on cold open.
      const restored = apiClient.isLoggedIn() || (await apiClient.restoreSession());
      navigation.replace(restored ? 'Tabs' : 'Login');
    })();
  }, [navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.logoCircle}>
        <Text style={styles.logoText}>VB</Text>
      </View>
      <Text style={styles.title}>Vishakan Biotech</Text>
      <Text style={styles.subtitle}>Field Force Management Platform</Text>
      
      <ActivityIndicator size="large" color={color.primaryLight} style={styles.loader} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  logoCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: color.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    shadowColor: color.black,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 6,
  },
  logoText: {
    fontSize: font.heading,
    fontWeight: fontWeight.bold,
    color: color.primary,
  },
  title: {
    fontSize: font.heading,
    fontWeight: fontWeight.bold,
    color: color.white,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: font.body,
    color: color.primaryPale,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  loader: {
    marginTop: 40,
  },
});
