import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import {
  GIT_RPC_METHODS,
  type GitBranchesResult,
  type GitCommitResult,
  type GitFileStatus,
  type GitLogResult,
  type GitStatusResult,
} from '@mobily/shared';
import { useStationConnection } from '@/client/StationConnection';

export default function GitScreen() {
  const { rpc, state, pairing } = useStationConnection();
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [history, setHistory] = useState<GitLogResult | null>(null);
  const [branches, setBranches] = useState<GitBranchesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [commitOpen, setCommitOpen] = useState(false);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    if (!rpc || state !== 'connected') return;
    setLoading(true);
    setError('');
    try {
      const [nextStatus, nextBranches, nextHistory] = await Promise.all([
        rpc.request<GitStatusResult>(GIT_RPC_METHODS.STATUS, {}),
        rpc.request<GitBranchesResult>(GIT_RPC_METHODS.BRANCHES, {}),
        rpc.request<GitLogResult>(GIT_RPC_METHODS.LOG, { limit: 10 }),
      ]);
      setStatus(nextStatus);
      setBranches(nextBranches);
      setHistory(nextHistory);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load Git status');
    } finally {
      setLoading(false);
    }
  }, [rpc, state]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const mutate = useCallback(
    async (label: string, method: string, params: Record<string, string | string[]>) => {
      if (!rpc) return;
      setBusy(label);
      setError('');
      try {
        const next = await rpc.request<GitStatusResult>(method, params);
        setStatus(next);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Git operation failed');
      } finally {
        setBusy(null);
      }
    },
    [rpc],
  );

  const checkout = useCallback(
    async (branch: string) => {
      if (!rpc) return;
      setBusy(`branch:${branch}`);
      try {
        await rpc.request(GIT_RPC_METHODS.CHECKOUT, { branch });
        setBranchesOpen(false);
        await refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not switch branch');
      } finally {
        setBusy(null);
      }
    },
    [refresh, rpc],
  );

  const commit = useCallback(async () => {
    if (!rpc || message.trim().length === 0) return;
    setBusy('commit');
    try {
      await rpc.request<GitCommitResult>(GIT_RPC_METHODS.COMMIT, { message: message.trim() });
      setMessage('');
      setCommitOpen(false);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Commit failed');
    } finally {
      setBusy(null);
    }
  }, [message, refresh, rpc]);

  const openDiff = useCallback((file: GitFileStatus, staged: boolean) => {
    router.push({
      pathname: '/git-diff' as never,
      params: { path: file.path, staged: staged ? '1' : '0' },
    } as never);
  }, []);

  if (state !== 'connected' || !rpc) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.title}>Git</Text>
        <Text style={styles.muted}>Connect to a Station before opening its repository.</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.navigate('/hosts' as never)}>
          <Text style={styles.primaryText}>Choose Station</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Git · {pairing?.stationName}</Text>
          <Pressable onPress={() => setBranchesOpen(true)} accessibilityLabel="Choose branch">
            <Text style={styles.branch}>{status?.branch ?? 'Detached HEAD'} ▾</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => router.navigate('/terminal')}><Text style={styles.link}>Terminal</Text></Pressable>
        <Pressable onPress={() => router.navigate('/hosts' as never)}><Text style={styles.link}>Stations</Text></Pressable>
      </View>

      {error.length > 0 && <Text style={styles.error}>{error}</Text>}
      {loading && !status ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={status?.files ?? []}
          keyExtractor={(file) => `${file.path}:${file.previousPath ?? ''}`}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.summary}>
              <Text style={styles.summaryText}>
                {status?.clean ? 'Working tree clean' : `${status?.files.length ?? 0} changed files`}
              </Text>
              <View style={styles.actions}>
                <Pressable style={styles.secondaryButton} onPress={() => void refresh()}>
                  <Text style={styles.secondaryText}>Refresh</Text>
                </Pressable>
                <Pressable style={styles.primaryButton} onPress={() => setCommitOpen(true)}>
                  <Text style={styles.primaryText}>Commit</Text>
                </Pressable>
              </View>
              {history?.commits.slice(0, 3).map((entry) => (
                <Text key={entry.hash} style={styles.history} numberOfLines={1}>
                  {entry.abbreviatedHash} · {entry.message}
                </Text>
              ))}
            </View>
          }
          ListEmptyComponent={<Text style={styles.muted}>No local changes.</Text>}
          renderItem={({ item }) => {
            const hasWorking = item.workingTree !== null;
            const hasIndex = item.index !== null;
            return (
              <View style={styles.fileRow}>
                <Pressable style={styles.fileText} onPress={() => openDiff(item, !hasWorking && hasIndex)}>
                  <Text style={styles.fileName} numberOfLines={1}>{item.path}</Text>
                  <Text style={styles.fileState}>
                    {hasIndex ? `staged ${item.index}` : ''}{hasIndex && hasWorking ? ' · ' : ''}
                    {hasWorking ? item.workingTree : ''}
                  </Text>
                </Pressable>
                {hasWorking && (
                  <Pressable
                    style={styles.smallButton}
                    disabled={busy !== null}
                    onPress={() => void mutate(`stage:${item.path}`, GIT_RPC_METHODS.STAGE, { paths: [item.path] })}
                  ><Text style={styles.smallText}>Stage</Text></Pressable>
                )}
                {hasIndex && (
                  <Pressable
                    style={styles.smallButton}
                    disabled={busy !== null}
                    onPress={() => void mutate(`unstage:${item.path}`, GIT_RPC_METHODS.UNSTAGE, { paths: [item.path] })}
                  ><Text style={styles.smallText}>Undo</Text></Pressable>
                )}
              </View>
            );
          }}
        />
      )}

      <Modal visible={commitOpen} transparent animationType="fade" onRequestClose={() => setCommitOpen(false)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Commit staged changes</Text>
          <TextInput
            style={styles.input}
            value={message}
            onChangeText={setMessage}
            placeholder="Commit message"
            placeholderTextColor="#6e7681"
            multiline
            autoFocus
          />
          <View style={styles.actions}>
            <Pressable style={styles.secondaryButton} onPress={() => setCommitOpen(false)}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
            <Pressable style={styles.primaryButton} disabled={busy !== null || !message.trim()} onPress={() => void commit()}><Text style={styles.primaryText}>Commit</Text></Pressable>
          </View>
        </View></View>
      </Modal>

      <Modal visible={branchesOpen} transparent animationType="slide" onRequestClose={() => setBranchesOpen(false)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Local branches</Text>
          <FlatList
            data={branches?.branches ?? []}
            keyExtractor={(branch) => branch}
            renderItem={({ item }) => (
              <Pressable style={styles.branchRow} onPress={() => void checkout(item)}>
                <Text style={[styles.fileName, item === branches?.current && styles.currentBranch]}>{item}</Text>
              </Pressable>
            )}
          />
          <Pressable style={styles.secondaryButton} onPress={() => setBranchesOpen(false)}><Text style={styles.secondaryText}>Close</Text></Pressable>
        </View></View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117' },
  center: { flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#30363d' },
  headerText: { flex: 1 },
  title: { color: '#f0f6fc', fontSize: 21, fontWeight: '700' },
  branch: { color: '#58a6ff', marginTop: 5 },
  link: { color: '#58a6ff', fontWeight: '600' },
  error: { color: '#ff7b72', backgroundColor: '#2d1117', padding: 10 },
  muted: { color: '#8b949e', textAlign: 'center' },
  list: { padding: 12, gap: 8 },
  summary: { gap: 9, paddingBottom: 8 },
  summaryText: { color: '#c9d1d9', fontSize: 15 },
  actions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  history: { color: '#8b949e', fontSize: 12 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 8 },
  fileText: { flex: 1 },
  fileName: { color: '#f0f6fc', fontSize: 14, fontWeight: '600' },
  fileState: { color: '#8b949e', fontSize: 11, marginTop: 4 },
  primaryButton: { backgroundColor: '#238636', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 7 },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondaryButton: { borderWidth: 1, borderColor: '#30363d', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 7 },
  secondaryText: { color: '#c9d1d9', fontWeight: '600' },
  smallButton: { borderWidth: 1, borderColor: '#30363d', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7 },
  smallText: { color: '#58a6ff', fontSize: 12, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', padding: 24 },
  modalCard: { maxHeight: '75%', backgroundColor: '#161b22', borderRadius: 12, borderWidth: 1, borderColor: '#30363d', padding: 18, gap: 14 },
  modalTitle: { color: '#f0f6fc', fontSize: 19, fontWeight: '700' },
  input: { minHeight: 100, color: '#f0f6fc', backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 8, padding: 12, textAlignVertical: 'top' },
  branchRow: { paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#30363d' },
  currentBranch: { color: '#3fb950' },
});
