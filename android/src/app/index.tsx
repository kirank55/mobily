import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';

import { loadPairing, type PairingRecord } from '@/auth/storage';

export default function HomeScreen() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const record = await loadPairing();
      if (record) {
        router.replace('/terminal');
      } else {
        router.replace('/scanner');
      }
      setReady(true);
    })();
  }, []);

  if (!ready) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return <View style={styles.container} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
