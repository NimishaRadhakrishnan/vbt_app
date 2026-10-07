import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import PrivacyPolicyScreen from '../screens/PrivacyPolicyScreen';
import LocationDisclosureScreen from '../screens/LocationDisclosureScreen';
import TabNavigator from './TabNavigator';
import { apiClient } from '../services/api';
import { LocationService } from '../services/LocationService';

const Stack = createStackNavigator();
const navigationRef = createNavigationContainerRef();

// Login-first: Splash and Login are the only screens outside the Tabs
// navigator, so nothing behind Tabs is reachable before authentication.
// Dashboard-as-home is enforced inside TabNavigator (DashboardTab is
// registered first) and by Splash/Login both routing to 'Tabs' on success.
//
// PrivacyPolicy is registered HERE, at the root/auth level, in addition
// to its existing registration inside ProfileStack. It has to be
// reachable BEFORE sign-in: Play Store policy expects the privacy
// policy to be accessible without an account, and it previously lived
// only inside ProfileStack, which doesn't exist until after login - so
// the Login screen had no way to reach it at all.
export default function AppNavigator() {
  // When the server refuses the saved login for good (the 7-day sign-in ran
  // out, or the account was changed), go to Login once with a clear message,
  // instead of leaving every screen showing an error.
  useEffect(() => {
    apiClient.onAuthExpired(() => {
      LocationService.stopTracking();
      apiClient.logout();
      if (navigationRef.isReady()) {
        navigationRef.reset({ index: 0, routes: [{ name: 'Login' }] });
      }
      Alert.alert('Please sign in again', 'Your sign-in has expired. Sign in once more to continue.');
    });
    return () => apiClient.onAuthExpired(null);
  }, []);

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator initialRouteName="Splash" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen
          name="PrivacyPolicy"
          component={PrivacyPolicyScreen}
          options={{ headerShown: true, title: 'Privacy Policy' }}
        />
        {/* Registered BETWEEN Login and Tabs, and with gestures off.
            Google requires the disclosure before the OS permission
            prompt; a swipe-back past it would let an officer reach the
            app having neither accepted nor declined, leaving no record
            of which they did. */}
        <Stack.Screen
          name="LocationDisclosure"
          component={LocationDisclosureScreen}
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="Tabs" component={TabNavigator} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
