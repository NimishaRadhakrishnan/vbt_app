import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

// Camera capture that survives the usual Android failures: the OS can kill
// the app while the camera is open (the photo then arrives later through
// getPendingResultAsync), and the launch itself can throw.
export async function takePhoto(quality = 0.5): Promise<string | null> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera Required', 'Allow camera access in Settings to take a photo, or choose one from the gallery.');
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return null;
    return result.assets[0].uri;
  } catch (err: any) {
    Alert.alert('Camera problem', `${err?.message || 'The camera could not be opened.'}\n\nYou can choose a photo from the gallery instead.`);
    return null;
  }
}

// A photo taken just before Android closed the app. Call once on screen mount.
export async function recoverPendingPhotos(): Promise<string[]> {
  try {
    const pending: any = await (ImagePicker as any).getPendingResultAsync?.();
    const list = Array.isArray(pending) ? pending : pending?.assets ? pending.assets : [];
    return list.map((a: any) => a?.uri).filter(Boolean);
  } catch {
    return [];
  }
}
