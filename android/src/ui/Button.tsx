import { Pressable, StyleSheet, Text, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fonts, minTouchTarget, spacing } from './theme';

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

const styles = StyleSheet.create({
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
});
