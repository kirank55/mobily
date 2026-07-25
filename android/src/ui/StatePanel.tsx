import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, type } from './theme';
import { Status, type StatusTone } from './Status';

export function StatePanel({
  label,
  detail,
  tone = 'neutral',
  loading = false,
  action,
}: {
  label: string;
  detail?: string;
  tone?: StatusTone;
  loading?: boolean;
  action?: ReactNode;
}) {
  return (
    <View style={styles.statePanel} accessibilityLiveRegion="polite">
      {loading ? <ActivityIndicator color={colors.ink} /> : null}
      <View style={styles.stateStatus}>
        <Status label={label} tone={tone} />
      </View>
      {detail ? <Text style={styles.stateDetail}>{detail}</Text> : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  statePanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x3,
    padding: spacing.x8,
    backgroundColor: colors.canvas,
  },
  stateStatus: { alignSelf: 'stretch', alignItems: 'center' },
  stateDetail: { ...type.body, color: colors.muted, textAlign: 'center', maxWidth: 440 },
});
