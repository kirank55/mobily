import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { listPairings, selectPairing, type PairingRecord } from '@/auth/storage';
import { useStationConnection } from '@/client/StationConnection';
import { probeStation } from './probe';

type Reachability = 'checking' | 'online' | 'offline';

export default function HostsScreen() {
  const [pairings, setPairings] = useState<PairingRecord[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Reachability>>({});
  const [loading, setLoading] = useState(true);
  const { connect, pairing: connectedPairing, state } = useStationConnection();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const controller = new AbortController();
      void (async () => {
        const records = await listPairings();
        if (cancelled) return;
        setPairings(records);
        setLoading(false);
        setStatuses(
          Object.fromEntries(records.map((record) => [record.deviceBindingId, 'checking'])),
        );
        for (let start = 0; start < records.length && !controller.signal.aborted; start += 4) {
          await Promise.all(
            records.slice(start, start + 4).map(async (record) => {
              const online = await probeStation(record, 3_000, controller.signal);
              if (!cancelled) {
                setStatuses((current) => ({
                  ...current,
                  [record.deviceBindingId]: online ? 'online' : 'offline',
                }));
              }
            }),
          );
        }
      })();
      return () => {
        cancelled = true;
        controller.abort();
      };
    }, []),
  );

  const open = useCallback(
    async (record: PairingRecord) => {
      await selectPairing(record.deviceBindingId);
      connect(record);
      router.navigate('/terminal');
    },
    [connect],
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Stations</Text>
          <Text style={styles.subtitle}>Choose where you want to work</Text>
        </View>
        <Pressable
          style={styles.addButton}
          onPress={() => router.push('/scanner')}
          accessibilityLabel="Add Station"
        >
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>
      <FlatList
        data={pairings}
        keyExtractor={(record) => record.deviceBindingId}
        contentContainerStyle={pairings.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>No paired Stations</Text>
            <Text style={styles.subtitle}>Add a Station by scanning its Mobily QR code.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const active = connectedPairing?.deviceBindingId === item.deviceBindingId;
          const reachability = active && state === 'connected' ? 'online' : statuses[item.deviceBindingId];
          return (
            <Pressable
              style={[styles.card, active && styles.activeCard]}
              onPress={() => void open(item)}
              accessibilityLabel={`Open ${item.stationName}`}
            >
              <View style={[styles.dot, styles[reachability ?? 'checking']]} />
              <View style={styles.cardText}>
                <Text style={styles.stationName}>{item.stationName}</Text>
                <Text style={styles.lastConnected}>
                  {item.lastConnectedAt
                    ? `Last connected ${new Date(item.lastConnectedAt).toLocaleString()}`
                    : 'Not connected yet'}
                </Text>
              </View>
              <Text style={styles.status}>{reachability ?? 'checking'}</Text>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomColor: '#30363d',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { color: '#f0f6fc', fontSize: 26, fontWeight: '700' },
  subtitle: { color: '#8b949e', fontSize: 14, marginTop: 4 },
  addButton: { backgroundColor: '#238636', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10 },
  addButtonText: { color: '#fff', fontWeight: '700' },
  list: { padding: 16, gap: 12 },
  emptyList: { flexGrow: 1 },
  emptyTitle: { color: '#f0f6fc', fontSize: 18, fontWeight: '600' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#161b22',
  },
  activeCard: { borderColor: '#58a6ff' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  checking: { backgroundColor: '#8b949e' },
  online: { backgroundColor: '#2ea043' },
  offline: { backgroundColor: '#f85149' },
  cardText: { flex: 1 },
  stationName: { color: '#f0f6fc', fontSize: 17, fontWeight: '600' },
  lastConnected: { color: '#8b949e', fontSize: 12, marginTop: 4 },
  status: { color: '#8b949e', fontSize: 12, textTransform: 'capitalize' },
});
