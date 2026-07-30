import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, spacing } from './theme';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

export function Status({
  label,
  tone = 'neutral',
  centered = false,
}: {
  label: string;
  tone?: StatusTone;
  centered?: boolean;
}) {
  return (
    <View style={[styles.status, centered && styles.centeredStatus, styles[`${tone}Status`]]}>
      <View style={[styles.statusDot, styles[`${tone}Dot`]]} />
      <Text style={[styles.statusLabel, styles[`${tone}StatusLabel`]]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  status: {
    minHeight: 28,
    alignSelf: 'flex-start',
    maxWidth: 150,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.x2,
    paddingHorizontal: spacing.x2,
    flexShrink: 1,
  },
  centeredStatus: { alignSelf: 'center' },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusLabel: {
    fontFamily: fonts.monoSemiBold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  neutralStatus: { backgroundColor: colors.surface, borderColor: colors.border },
  neutralDot: { backgroundColor: colors.muted },
  neutralStatusLabel: { color: colors.muted },
  successStatus: { backgroundColor: colors.successSurface, borderColor: colors.success },
  successDot: { backgroundColor: colors.success },
  successStatusLabel: { color: colors.success },
  warningStatus: { backgroundColor: colors.warningSurface, borderColor: colors.warning },
  warningDot: { backgroundColor: colors.warning },
  warningStatusLabel: { color: colors.warning },
  dangerStatus: { backgroundColor: colors.dangerSurface, borderColor: colors.danger },
  dangerDot: { backgroundColor: colors.danger },
  dangerStatusLabel: { color: colors.danger },
});
