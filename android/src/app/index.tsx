import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';

import { listPairings } from '@/auth/storage';

export default function HomeScreen() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const records = await listPairings();
      if (records.length > 0) {
        router.replace('/hosts' as never);
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
