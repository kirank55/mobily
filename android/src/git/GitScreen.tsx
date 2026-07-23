import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import { Button, Field, Screen, Status } from '@/ui/components';
import { colors, fonts, minTouchTarget, spacing, type } from '@/ui/theme';

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
      <Screen style={styles.center}>
        <Text style={styles.kicker}>03 / GIT</Text>
        <Text style={styles.title}>Git</Text>
        <Text style={styles.muted}>Connect to a Station before opening its repository.</Text>
        <Button
          label="Choose Station"
          variant="primary"
          onPress={() => router.navigate('/hosts' as never)}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Git · {pairing?.stationName}</Text>
          <Pressable
            style={styles.branchButton}
            onPress={() => setBranchesOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Choose branch"
          >
            <Text style={styles.branch}>{status?.branch ?? 'Detached HEAD'} ▾</Text>
          </Pressable>
        </View>
        <Pressable
          style={styles.navButton}
          onPress={() => router.navigate('/terminal')}
          accessibilityRole="button"
        >
          <Text style={styles.link}>Terminal</Text>
        </Pressable>
        <Pressable
          style={styles.navButton}
          onPress={() => router.navigate('/hosts' as never)}
          accessibilityRole="button"
        >
          <Text style={styles.link}>Stations</Text>
        </Pressable>
      </View>

      {error.length > 0 && (
        <View style={styles.errorBar} accessibilityLiveRegion="polite">
          <Text style={styles.error}>{error}</Text>
          <Button label="Retry" compact onPress={() => void refresh()} />
        </View>
      )}
      {loading && !status ? (
        <View style={styles.loadingPanel} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.ink} />
          <Status label="Loading repository" />
        </View>
      ) : (
        <FlatList
          data={status?.files ?? []}
          keyExtractor={(file) => `${file.path}:${file.previousPath ?? ''}`}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.summary}>
              <Status
                label={
                  status?.clean
                    ? 'Working tree clean'
                    : `${status?.files.length ?? 0} changed files`
                }
                tone={status?.clean ? 'success' : 'warning'}
              />
              <View style={styles.actions}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void refresh()}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>Refresh</Text>
                </Pressable>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => setCommitOpen(true)}
                  accessibilityRole="button"
                >
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
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.muted}>No local changes.</Text>
              <Button label="Refresh" onPress={() => void refresh()} />
            </View>
          }
          renderItem={({ item }) => {
            const hasWorking = item.workingTree !== null;
            const hasIndex = item.index !== null;
            return (
              <View style={styles.fileRow}>
                <Pressable
                  style={styles.fileText}
                  onPress={() => openDiff(item, !hasWorking && hasIndex)}
                  accessibilityRole="button"
                >
                  <Text style={styles.fileName} numberOfLines={1}>
                    {item.path}
                  </Text>
                  <Text style={styles.fileState}>
                    {hasIndex ? `staged ${item.index}` : ''}
                    {hasIndex && hasWorking ? ' · ' : ''}
                    {hasWorking ? item.workingTree : ''}
                  </Text>
                </Pressable>
                {hasWorking && (
                  <Pressable
                    style={styles.smallButton}
                    disabled={busy !== null}
                    accessibilityRole="button"
                    onPress={() =>
                      void mutate(`stage:${item.path}`, GIT_RPC_METHODS.STAGE, {
                        paths: [item.path],
                      })
                    }
                  >
                    <Text style={styles.smallText}>Stage</Text>
                  </Pressable>
                )}
                {hasIndex && (
                  <Pressable
                    style={styles.smallButton}
                    disabled={busy !== null}
                    accessibilityRole="button"
                    onPress={() =>
                      void mutate(`unstage:${item.path}`, GIT_RPC_METHODS.UNSTAGE, {
                        paths: [item.path],
                      })
                    }
                  >
                    <Text style={styles.smallText}>Undo</Text>
                  </Pressable>
                )}
              </View>
            );
          }}
        />
      )}

      <Modal
        visible={commitOpen}
        transparent
        animationType="none"
        onRequestClose={() => setCommitOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={styles.modalCard}
            accessibilityViewIsModal
            accessibilityLabel="Commit staged changes"
          >
            <Text style={styles.modalTitle} accessibilityRole="header">
              Commit staged changes
            </Text>
            <Field
              label="Commit message"
              style={styles.input}
              value={message}
              onChangeText={setMessage}
              placeholder="Commit message"
              multiline
              autoFocus
            />
            <View style={styles.actions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => setCommitOpen(false)}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                disabled={busy !== null || !message.trim()}
                onPress={() => void commit()}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>Commit</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={branchesOpen}
        transparent
        animationType="none"
        onRequestClose={() => setBranchesOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={styles.modalCard}
            accessibilityViewIsModal
            accessibilityLabel="Local branches"
          >
            <Text style={styles.modalTitle} accessibilityRole="header">
              Local branches
            </Text>
            <FlatList
              data={branches?.branches ?? []}
              keyExtractor={(branch) => branch}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.branchRow}
                  onPress={() => void checkout(item)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: item === branches?.current }}
                >
                  <Text
                    style={[styles.fileName, item === branches?.current && styles.currentBranch]}
                  >
                    {item === branches?.current ? '> ' : '  '}
                    {item}
                  </Text>
                </Pressable>
              )}
            />
            <Pressable
              style={styles.secondaryButton}
              onPress={() => setBranchesOpen(false)}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.x4, padding: spacing.x6 },
  kicker: { ...type.label, color: colors.muted },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
    minHeight: 72,
    padding: spacing.x4,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },
  headerText: { flex: 1 },
  title: { ...type.title },
  branch: { color: colors.ink, fontFamily: fonts.monoMedium, marginTop: spacing.x1 },
  branchButton: { minHeight: minTouchTarget, justifyContent: 'center' },
  navButton: { minHeight: minTouchTarget, justifyContent: 'center', paddingHorizontal: spacing.x2 },
  link: {
    color: colors.ink,
    fontFamily: fonts.monoSemiBold,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    backgroundColor: colors.dangerSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.danger,
    padding: spacing.x3,
  },
  error: {
    ...type.body,
    flex: 1,
    color: colors.danger,
  },
  loadingPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.x3 },
  muted: { ...type.body, color: colors.muted, textAlign: 'center' },
  list: { padding: spacing.x3 },
  emptyState: { alignItems: 'center', gap: spacing.x4, padding: spacing.x8 },
  summary: { gap: spacing.x3, paddingBottom: spacing.x3 },
  actions: { flexDirection: 'row', gap: spacing.x2, justifyContent: 'flex-end' },
  history: { ...type.meta },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
    minHeight: 68,
    padding: spacing.x3,
    marginTop: -1,
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fileText: { flex: 1, minHeight: minTouchTarget, justifyContent: 'center' },
  fileName: { color: colors.ink, fontFamily: fonts.monoSemiBold, fontSize: 13 },
  fileState: { ...type.meta, marginTop: spacing.x1 },
  primaryButton: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.ink,
    paddingHorizontal: spacing.x4,
  },
  primaryText: {
    color: colors.canvas,
    fontFamily: fonts.monoSemiBold,
    textTransform: 'uppercase',
    fontSize: 12,
  },
  secondaryButton: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.ink,
    paddingHorizontal: spacing.x4,
    backgroundColor: colors.canvas,
  },
  secondaryText: {
    color: colors.ink,
    fontFamily: fonts.monoSemiBold,
    textTransform: 'uppercase',
    fontSize: 12,
  },
  smallButton: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.ink,
    paddingHorizontal: spacing.x3,
  },
  smallText: {
    color: colors.ink,
    fontFamily: fonts.monoSemiBold,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'center',
    padding: spacing.x6,
  },
  modalCard: {
    maxHeight: '75%',
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.ink,
    padding: spacing.x4,
    gap: spacing.x4,
  },
  modalTitle: { ...type.title },
  input: {
    minHeight: 100,
    color: colors.ink,
    fontFamily: fonts.body,
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.ink,
    padding: spacing.x3,
    textAlignVertical: 'top',
  },
  branchRow: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  currentBranch: { color: colors.ink, fontFamily: fonts.monoBold },
});
