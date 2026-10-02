import 'react-native-gesture-handler';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  // GPS tracking starts from LoginScreen after a real sign-in, not here -
  // starting it before login meant pings had no logged-in officer to
  // attach to.
  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}
