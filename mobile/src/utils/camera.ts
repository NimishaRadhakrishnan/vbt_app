import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

// Photos are taken with the in-app camera (components/CameraHost.tsx, mounted
// once in App.tsx). Opening the phone's separate camera app made Android
// close this app on some phones, losing the photo. If the in-app camera is
// not mounted for any reason, this falls back to the system camera.

export type CameraRequest = { quality: number; resolve: (uri: string | null) => void };

let host: ((r: CameraRequest) => void) | null = null;

export function registerCameraHost(fn: (r: CameraRequest) => void): () => void {
  host = fn;
  return () => { if (host === fn) host = null; };
}

export async function takePhoto(quality = 0.5): Promise<string | null> {
  if (host) {
    return new Promise<string | null>((resolve) => host!({ quality, resolve }));
  }
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

// A photo taken just before Android closed the app (system-camera fallback).
export async function recoverPendingPhotos(): Promise<string[]> {
  try {
    const pending: any = await (ImagePicker as any).getPendingResultAsync?.();
    const list = Array.isArray(pending) ? pending : pending?.assets ? pending.assets : [];
    return list.map((a: any) => a?.uri).filter(Boolean);
  } catch {
    return [];
  }
}
