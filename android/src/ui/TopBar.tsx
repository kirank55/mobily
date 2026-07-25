import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, type } from './theme';

export function TopBar({
  title,
  eyebrow,
  actions,
}: {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <View style={styles.topBar}>
      <View style={styles.topBarText}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {actions ? <View style={styles.topBarActions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    paddingHorizontal: spacing.x4,
    paddingVertical: spacing.x3,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },
  topBarText: { flex: 1 },
  eyebrow: { ...type.meta, marginBottom: 2, textTransform: 'uppercase' },
  topBarTitle: { ...type.title },
  topBarActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
});
