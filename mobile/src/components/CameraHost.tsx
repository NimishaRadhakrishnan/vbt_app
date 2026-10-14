import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { registerCameraHost, type CameraRequest } from '../utils/camera';
import { color, font, fontWeight, spacing } from '../theme';

// A camera that lives inside the app. Opening the phone's separate camera app
// makes Android close this app on some phones and the photo is lost; this one
// never leaves the screen. Mounted once at the root (App.tsx).
export default function CameraHost() {
  const [request, setRequest] = useState<CameraRequest | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);

  useEffect(() => registerCameraHost((r) => { setReady(false); setRequest(r); }), []);

  // Ask for permission as soon as the camera is requested.
  useEffect(() => {
    if (request && permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [request, permission, requestPermission]);

  const finish = (uri: string | null) => {
    const r = request;
    setRequest(null);
    setBusy(false);
    r?.resolve(uri);
  };

  const capture = async () => {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: request?.quality ?? 0.5, skipProcessing: false });
      finish(pic?.uri ?? null);
    } catch (err: any) {
      setBusy(false);
      Alert.alert('Camera problem', err?.message || 'Could not take the photo. Please try again.');
    }
  };

  const denied = !!permission && !permission.granted && !permission.canAskAgain;

  return (
    <Modal visible={!!request} animationType="slide" onRequestClose={() => finish(null)} statusBarTranslucent>
      <View style={styles.container}>
        {permission?.granted ? (
          <>
            <CameraView
              ref={(r) => { cameraRef.current = r; }}
              style={StyleSheet.absoluteFill}
              facing={facing}
              onCameraReady={() => setReady(true)}
            />
            <View style={styles.topBar}>
              <TouchableOpacity onPress={() => finish(null)} style={styles.pill} accessibilityLabel="Close camera">
                <Text style={styles.pillText}>✕ Close</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} style={styles.pill} accessibilityLabel="Switch camera">
                <Text style={styles.pillText}>⟲ Flip</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.bottomBar}>
              <TouchableOpacity
                onPress={capture}
                disabled={busy || !ready}
                style={[styles.shutter, (busy || !ready) && { opacity: 0.5 }]}
                accessibilityLabel="Take photo"
              >
                {busy ? <ActivityIndicator color={color.primary} /> : <View style={styles.shutterInner} />}
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.center}>
            <Text style={styles.msg}>
              {denied
                ? 'Camera access is turned off for this app. Open your phone Settings → Apps → VBT One → Permissions and allow Camera.'
                : 'Waiting for camera permission…'}
            </Text>
            <TouchableOpacity onPress={() => finish(null)} style={[styles.pill, { marginTop: spacing.xl }]}>
              <Text style={styles.pillText}>Close</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  topBar: { position: 'absolute', top: 40, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  bottomBar: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' },
  pill: { backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24 },
  pillText: { color: '#fff', fontSize: font.body, fontWeight: fontWeight.bold },
  shutter: { width: 78, height: 78, borderRadius: 39, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: color.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  msg: { color: '#fff', textAlign: 'center', fontSize: font.body },
});
