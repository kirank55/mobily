import { Platform } from 'react-native';

/** Dev-only: Expo web may use plaintext `ws://` against `--allow-insecure-local`. */
export function allowInsecureStationTransport(): boolean {
  return __DEV__ && Platform.OS === 'web';
}
