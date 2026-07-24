import { useId, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, fonts, minTouchTarget, spacing, type } from './theme';

export function Screen({
  children,
  edges = ['top'],
  style,
}: {
  children: ReactNode;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={edges}>
      {children}
    </SafeAreaView>
  );
}

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

type ButtonVariant = 'primary' | 'secondary' | 'text';

export function Button({
  label,
  variant = 'secondary',
  compact = false,
  style,
  ...props
}: Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: ButtonVariant;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        styles[`${variant}Button`],
        pressed &&
          !props.disabled &&
          (variant === 'primary' ? styles.primaryButtonPressed : styles.buttonPressed),
        props.disabled && styles.buttonDisabled,
        style,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          styles[`${variant}Label`],
          props.disabled && styles.buttonDisabledLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

export function Status({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  return (
    <View style={[styles.status, styles[`${tone}Status`]]}>
      <View style={[styles.statusDot, styles[`${tone}Dot`]]} />
      <Text style={[styles.statusLabel, styles[`${tone}StatusLabel`]]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function Field({
  label,
  error,
  style,
  nativeID,
  onFocus,
  onBlur,
  accessibilityHint,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  const generatedId = useId().replace(/:/g, '');
  const inputId = nativeID ?? `field-${generatedId}`;
  const labelId = `${inputId}-label`;
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.fieldGroup}>
      <Text nativeID={labelId} style={styles.fieldLabel}>
        {label}
      </Text>
      <View style={[styles.fieldFrame, focused && styles.fieldFrameFocused]}>
        <TextInput
          {...props}
          nativeID={inputId}
          accessibilityLabelledBy={labelId}
          accessibilityHint={error ?? accessibilityHint}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.field, error ? styles.fieldError : null, style]}
          placeholderTextColor={colors.muted}
        />
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

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
  screen: { flex: 1, backgroundColor: colors.canvas },
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
  button: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    paddingHorizontal: spacing.x4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.ink,
  },
  buttonCompact: { paddingHorizontal: spacing.x3 },
  primaryButton: { backgroundColor: colors.ink },
  secondaryButton: { backgroundColor: colors.canvas },
  textButton: { borderColor: 'transparent', backgroundColor: 'transparent' },
  buttonPressed: { backgroundColor: colors.surfaceRaised },
  primaryButtonPressed: { backgroundColor: colors.muted },
  buttonDisabled: { borderColor: colors.border, backgroundColor: colors.surface },
  buttonLabel: {
    fontFamily: fonts.monoSemiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.25,
    textTransform: 'uppercase',
  },
  primaryLabel: { color: colors.canvas },
  secondaryLabel: { color: colors.ink },
  textLabel: { color: colors.ink },
  buttonDisabledLabel: { color: colors.muted },
  status: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x2,
    paddingHorizontal: spacing.x2,
    borderWidth: 1,
    flexShrink: 1,
  },
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
  fieldGroup: { gap: spacing.x2 },
  fieldLabel: { ...type.label },
  fieldFrame: { borderWidth: 2, borderColor: 'transparent', padding: 2 },
  fieldFrameFocused: { borderColor: colors.ink },
  field: {
    minHeight: minTouchTarget,
    borderWidth: 1,
    borderColor: colors.ink,
    backgroundColor: colors.canvas,
    color: colors.ink,
    paddingHorizontal: spacing.x3,
    paddingVertical: spacing.x2,
    fontFamily: fonts.mono,
    fontSize: 14,
  },
  fieldError: { borderColor: colors.danger, borderWidth: 2 },
  errorText: { ...type.body, color: colors.danger },
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
