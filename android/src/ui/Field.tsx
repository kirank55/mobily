import { useId, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, fonts, minTouchTarget, spacing, type } from './theme';

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

const styles = StyleSheet.create({
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
});
