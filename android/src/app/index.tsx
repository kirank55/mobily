import { useEffect, useState } from 'react';
import { router } from 'expo-router';

import { listPairings } from '@/auth/storage';
import { StatePanel, Screen } from '@/ui/components';

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
      <Screen>
        <StatePanel label="Loading Stations" loading />
      </Screen>
    );
  }

  return (
    <Screen>
      <StatePanel label="Opening Mobily" loading />
    </Screen>
  );
}
