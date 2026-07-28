import { useCallback, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { deleteKey } from '@/auth/deviceKey';
import {
  listPairings,
  pruneStalePairings,
  selectPairing,
  type PairingRecord,
} from '@/auth/storage';
import { useStationConnection } from '@/client/StationConnection';
import { Button, Screen, StatePanel, Status, TopBar } from '@/ui/components';
import { colors, fonts, spacing, type } from '@/ui/theme';
import { probeStation } from './probe';
import { buildPairingSections } from './recency';

type Reachability = 'checking' | 'online' | 'offline';

export default function StationsScreen() {
  const [pairings, setPairings] = useState<PairingRecord[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Reachability>>({});
  const [loading, setLoading] = useState(true);
  const { connect, pairing: connectedPairing, state } = useStationConnection();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const controller = new AbortController();
      void (async () => {
        const stale = await pruneStalePairings();
        await Promise.all(
          stale.map((record) =>
            deleteKey(record.keyAlias).catch((error) => {
              console.warn('[Mobily][Stations] Failed to delete an expired Device Key', error);
            }),
          ),
        );
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
      <Screen>
        <StatePanel label="Checking Stations" loading />
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar
        eyebrow="01 / Stations"
        title="Choose your Station"
        actions={
          <Button
            label="Add"
            variant="primary"
            compact
            onPress={() => router.push('/scanner')}
            accessibilityLabel="Add Station"
          />
        }
      />
      <SectionList
        sections={buildPairingSections(pairings)}
        keyExtractor={(record) => record.deviceBindingId}
        contentContainerStyle={pairings.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>NO PAIRED STATIONS</Text>
            <Text style={styles.subtitle}>Scan the QR code shown by the Mobily CLI to begin.</Text>
            <Button label="Add Station" variant="primary" onPress={() => router.push('/scanner')} />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>{section.title}</Text>
        )}
        renderItem={({ item }) => {
          const active = connectedPairing?.deviceBindingId === item.deviceBindingId;
          const reachability =
            active && state === 'connected' ? 'online' : statuses[item.deviceBindingId];
          return (
            <Pressable
              style={[styles.card, active && styles.activeCard]}
              onPress={() => void open(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Open ${item.stationName}`}
            >
              <View style={styles.cardText}>
                <Text style={styles.stationName}>{item.stationName}</Text>
                <Text style={styles.lastConnected}>
                  {item.lastConnectedAt
                    ? `Last connected ${new Date(item.lastConnectedAt).toLocaleString()}`
                    : 'Not connected yet'}
                </Text>
              </View>
              <Status
                label={reachability ?? 'checking'}
                tone={
                  reachability === 'online'
                    ? 'success'
                    : reachability === 'offline'
                      ? 'danger'
                      : 'neutral'
                }
              />
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x4,
    padding: spacing.x6,
  },
  subtitle: { ...type.body, color: colors.muted, textAlign: 'center' },
  list: { padding: spacing.x4 },
  sectionTitle: {
    ...type.label,
    paddingTop: spacing.x4,
    paddingBottom: spacing.x2,
    backgroundColor: colors.canvas,
  },
  emptyList: { flexGrow: 1 },
  emptyTitle: { ...type.title, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    minHeight: 84,
    padding: spacing.x4,
    marginTop: -1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
  },
  activeCard: { borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface },
  cardText: { flex: 1 },
  stationName: { color: colors.ink, fontFamily: fonts.monoSemiBold, fontSize: 16 },
  lastConnected: { ...type.meta, marginTop: spacing.x1 },
});
