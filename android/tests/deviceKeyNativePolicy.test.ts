import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const nativeModule = readFileSync(
  resolve(
    process.cwd(),
    'modules/mobily-device-key/android/src/main/java/expo/modules/mobilydevicekey/MobilyDeviceKeyModule.kt',
  ),
  'utf8',
);

describe('native Device Key authentication policy', () => {
  it('uses one short biometric grace window for reconnect challenge signing', () => {
    expect(nativeModule).toContain('private const val AUTHENTICATION_VALIDITY_SECONDS = 1800');
    expect(nativeModule).toContain(
      'setUserAuthenticationParameters(\n            AUTHENTICATION_VALIDITY_SECONDS,',
    );
    expect(nativeModule).toContain(
      'setUserAuthenticationValidityDurationSeconds(AUTHENTICATION_VALIDITY_SECONDS)',
    );
    expect(nativeModule).toContain('signWithRecentAuthentication(');
    expect(nativeModule).toContain('UserNotAuthenticatedException');
  });
});
