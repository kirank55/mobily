import { StyleSheet } from 'react-native';
import { colors, fonts } from './tokens';

export { colors, fonts, hairline, minTouchTarget, spacing } from './tokens';

export const type = StyleSheet.create({
  display: {
    color: colors.ink,
    fontFamily: fonts.monoBold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -1,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.monoSemiBold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.35,
  },
  label: {
    color: colors.ink,
    fontFamily: fonts.monoSemiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  body: {
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
  },
  meta: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 16,
  },
});
