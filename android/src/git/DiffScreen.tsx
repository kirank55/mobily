import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { GIT_RPC_METHODS, type JsonObject } from '@mobily/shared';
import { useStationConnection } from '@/client/StationConnection';
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}><Text style={styles.link}>Back</Text></Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{path || 'Diff'}</Text>
          <Text style={styles.muted}>{staged ? 'Staged changes' : 'Working tree changes'}</Text>
        </View>
        <Pressable onPress={() => setMode(mode === 'unified' ? 'side-by-side' : 'unified')}>
          <Text style={styles.link}>{mode === 'unified' ? 'Split' : 'Unified'}</Text>
        </Pressable>
      </View>
      {error.length > 0 && <Text style={styles.error}>{error}</Text>}
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
        ListEmptyComponent={!loading ? <Text style={styles.empty}>No textual diff.</Text> : null}
        ListFooterComponent={loading ? <ActivityIndicator style={styles.loader} /> : null}
        renderItem={({ item }) =>
          mode === 'unified' ? (
            <UnifiedRow line={item as DiffLine} />
          ) : (
            <SplitRow row={item as SideBySideRow} />
          )
        }
      />
    </SafeAreaView>
  );
}

function UnifiedRow({ line }: { line: DiffLine }) {
  return (
    <View style={[styles.diffRow, lineStyle(line)]}>
      <Text style={styles.lineNumber}>{line.oldLine ?? ''}</Text>
      <Text style={styles.lineNumber}>{line.newLine ?? ''}</Text>
      <Text style={styles.code} selectable>{line.content}</Text>
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
      <Text style={styles.lineNumber}>{line ? (side === 'left' ? line.oldLine : line.newLine) ?? '' : ''}</Text>
      <Text style={styles.code} numberOfLines={1}>{line?.content ?? ''}</Text>
    </View>
  );
}

function lineStyle(line: DiffLine) {
  switch (line.kind) {
    case 'addition': return styles.addition;
    case 'deletion': return styles.deletion;
    case 'hunk': return styles.hunk;
    case 'header': return styles.fileHeader;
    default: return undefined;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#30363d' },
  headerText: { flex: 1 },
  title: { color: '#f0f6fc', fontSize: 16, fontWeight: '700' },
  muted: { color: '#8b949e', fontSize: 11, marginTop: 2 },
  link: { color: '#58a6ff', fontWeight: '600' },
  error: { color: '#ff7b72', backgroundColor: '#2d1117', padding: 10 },
  empty: { color: '#8b949e', textAlign: 'center', padding: 40 },
  loader: { padding: 20 },
  diffRow: { minHeight: 23, flexDirection: 'row', alignItems: 'flex-start' },
  splitRow: { flexDirection: 'row', minHeight: 23 },
  cell: { width: '50%', flexDirection: 'row', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#30363d' },
  blankCell: { backgroundColor: '#161b22' },
  lineNumber: { width: 42, color: '#6e7681', textAlign: 'right', paddingRight: 7, fontFamily: 'monospace', fontSize: 11, lineHeight: 22 },
  code: { flex: 1, color: '#c9d1d9', fontFamily: 'monospace', fontSize: 11, lineHeight: 22 },
  addition: { backgroundColor: '#0f2d1b' },
  deletion: { backgroundColor: '#3b1518' },
  hunk: { backgroundColor: '#17294d' },
  fileHeader: { backgroundColor: '#21262d' },
});
