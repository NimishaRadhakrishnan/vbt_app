import { Alert } from 'react-native';
import { apiClient } from '../services/api';

/**
 * Opens the right day closure for this officer. The admin sets a work mode
 * per officer: field (farm visits), sales (dealer visits) or both. Only
 * "both" asks which one. The profile is refreshed first, so a mode the
 * admin changed an hour ago applies without signing out.
 */
export async function openDayClosure(navigation: { navigate: (name: string, params?: any) => void }) {
  await apiClient.refreshProfile();
  const mode = apiClient.getCurrentUser()?.workMode ?? 'both';
  const farm = () => navigation.navigate('DailyVisitTracker', { dayClosureMode: true });
  const dealer = () => navigation.navigate('SalesDayClosure');
  if (mode === 'field') return farm();
  if (mode === 'sales') return dealer();
  Alert.alert('Which closure?', 'Pick the kind of visit you did today.', [
    { text: 'Farm visit', onPress: farm },
    { text: 'Dealer visit', onPress: dealer },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
