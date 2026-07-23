import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { GIT_RPC_METHODS, type JsonObject } from '@mobily/shared';
import { useStationConnection } from '@/client/StationConnection';
import { Button, Screen, Status } from '@/ui/components';
import { colors, fonts, minTouchTarget, spacing, type } from '@/ui/theme';
import {
  parseUnifiedDiff,
  toSideBySideRows,
  type DiffLine,
  type SideBySideRow,
} from './diffParser';

type Mode = 'unified' | 'side-by-side';

export default function DiffScreen() {
  const params = useLocalSearchParams<{ path?: string; staged?: string }>();
  const path = typeof params.path === 'string' ? params.path : '';
  const staged = params.staged === '1';
  const { rpc, state } = useStationConnection();
  const [mode, setMode] = useState<Mode>('unified');
  const [raw, setRaw] = useState('');
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const rawRef = useRef('');
  const loadingRef = useRef(false);

  const load = useCallback(
    async (cursor?: string) => {
      if (!rpc || state !== 'connected' || !path || loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError('');
      let page = '';
      try {
        const result = await rpc.stream(
          GIT_RPC_METHODS.DIFF,
          {
            path,
            staged,
            maxLines: 500,
            ...(cursor ? { cursor } : {}),
          } as JsonObject,
          (chunk) => {
            page += chunk;
            setRaw(rawRef.current + page);
          },
        );
        rawRef.current += page;
        setRaw(rawRef.current);
        setNextCursor(result.nextCursor);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not load diff');
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [path, rpc, staged, state],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const lines = useMemo(() => parseUnifiedDiff(raw), [raw]);
  const sideRows = useMemo(() => toSideBySideRows(lines), [lines]);
  const data = (mode === 'unified' ? lines : sideRows) as (DiffLine | SideBySideRow)[];

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          style={styles.headerButton}
          onPress={() => router.back()}
          accessibilityRole="button"
        >
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {path || 'Diff'}
          </Text>
          <Text style={styles.muted}>{staged ? 'Staged changes' : 'Working tree changes'}</Text>
        </View>
        <Pressable
          style={styles.headerButton}
          onPress={() => setMode(mode === 'unified' ? 'side-by-side' : 'unified')}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === 'side-by-side' }}
        >
          <Text style={styles.link}>{mode === 'unified' ? 'Split' : 'Unified'}</Text>
        </Pressable>
      </View>
      {error.length > 0 && (
        <View style={styles.errorBar} accessibilityLiveRegion="polite">
          <Text style={styles.error}>{error}</Text>
          <Button label="Retry" compact onPress={() => void load()} />
        </View>
      )}
      <FlatList
        data={data}
        keyExtractor={(_item, index) => `${mode}:${index}`}
        initialNumToRender={30}
        maxToRenderPerBatch={40}
        windowSize={9}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (nextCursor && !loading) void load(nextCursor);
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Text style={styles.empty}>No textual diff.</Text>
              <Button label="Back" onPress={() => router.back()} />
            </View>
          ) : null
        }
        ListFooterComponent={
          loading ? (
            <View style={styles.loader} accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.ink} />
              <Status label="Loading diff" />
            </View>
          ) : null
        }
        renderItem={({ item }) =>
          mode === 'unified' ? (
            <UnifiedRow line={item as DiffLine} />
          ) : (
            <SplitRow row={item as SideBySideRow} />
          )
        }
      />
    </Screen>
  );
}

function UnifiedRow({ line }: { line: DiffLine }) {
  return (
    <View style={[styles.diffRow, lineStyle(line)]}>
      <Text style={styles.lineNumber}>{line.oldLine ?? ''}</Text>
      <Text style={styles.lineNumber}>{line.newLine ?? ''}</Text>
      <Text style={styles.code} selectable>
        {line.content}
      </Text>
    </View>
  );
}

function SplitRow({ row }: { row: SideBySideRow }) {
  return (
    <View style={styles.splitRow}>
      <DiffCell line={row.left} side="left" />
      <DiffCell line={row.right} side="right" />
    </View>
  );
}

function DiffCell({ line, side }: { line: DiffLine | null; side: 'left' | 'right' }) {
  return (
    <View style={[styles.cell, line ? lineStyle(line) : styles.blankCell]}>
      <Text style={styles.lineNumber}>
        {line ? ((side === 'left' ? line.oldLine : line.newLine) ?? '') : ''}
      </Text>
      <Text style={styles.code} numberOfLines={1}>
        {line?.content ?? ''}
      </Text>
    </View>
  );
}

function lineStyle(line: DiffLine) {
  switch (line.kind) {
    case 'addition':
      return styles.addition;
    case 'deletion':
      return styles.deletion;
    case 'hunk':
      return styles.hunk;
    case 'header':
      return styles.fileHeader;
    default:
      return undefined;
  }
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
    minHeight: 72,
    paddingHorizontal: spacing.x2,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },
  headerButton: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.x2,
  },
  headerText: { flex: 1 },
  title: { ...type.title, fontSize: 15, lineHeight: 20 },
  muted: { ...type.meta, marginTop: 2 },
  link: {
    color: colors.ink,
    fontFamily: fonts.monoSemiBold,
    fontSize: 11,
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
  empty: { ...type.body, color: colors.muted, textAlign: 'center', padding: spacing.x12 },
  emptyState: { alignItems: 'center', gap: spacing.x3 },
  loader: { alignItems: 'center', gap: spacing.x3, padding: spacing.x6 },
  diffRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  splitRow: { flexDirection: 'row', minHeight: 24 },
  cell: {
    width: '50%',
    flexDirection: 'row',
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  blankCell: { backgroundColor: colors.surface },
  lineNumber: {
    width: 42,
    color: colors.muted,
    textAlign: 'right',
    paddingRight: 7,
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 23,
  },
  code: { flex: 1, color: colors.ink, fontFamily: fonts.mono, fontSize: 11, lineHeight: 23 },
  addition: {
    backgroundColor: colors.successSurface,
    borderLeftWidth: 2,
    borderLeftColor: colors.success,
  },
  deletion: {
    backgroundColor: colors.dangerSurface,
    borderLeftWidth: 2,
    borderLeftColor: colors.danger,
  },
  hunk: { backgroundColor: colors.surfaceRaised },
  fileHeader: { backgroundColor: colors.surface },
});
