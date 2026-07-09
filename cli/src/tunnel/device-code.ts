/**
 * cli/src/tunnel/device-code.ts
 *
 * OAuth 2.0 device-code flow for Dev Tunnels authentication. The
 * `@microsoft/dev-tunnels` SDK does NOT include a device-code flow — it only
 * takes a `userTokenCallback`. This module implements the flow against the
 * Microsoft Entra ID device-code endpoints and returns an access token.
 *
 * The token audience is the Dev Tunnels first-party App ID
 * (`46da2f7e-b5ef-422a-88d4-2a7f9de6a0b2`), per the SDK's
 * `tunnelServiceProperties.ts`.
 */

/** A token plus its expiry, ready to feed to the SDK's `userTokenCallback`. */
export interface AuthToken {
  readonly token: string;
  readonly expiresAt: Date;
}

/** Dev Tunnels first-party App ID — the required token audience. */
const DEVICE_CODE_AUDIENCE = '46da2f7e-b5ef-422a-88d4-2a7f9de6a0b2';

/** Scope: Dev Tunnels audience + offline_access for refresh tokens. */
const SCOPE = `${DEVICE_CODE_AUDIENCE}/.default offline_access`;

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/**
 * Run the device-code flow: request a code, print instructions, poll until the
 * user completes sign-in. Resolves with the access token.
 */
export async function authenticate(
  clientId: string,
  tenantId: string,
): Promise<AuthToken> {
  const code = await requestDeviceCode(clientId, tenantId);

  console.log();
  console.log(code.message);
  console.log();

  const token = await pollForToken(clientId, tenantId, code.device_code, code.interval);
  return {
    token: token.access_token!,
    expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000),
  };
}

/** Step 1: request a device code from Entra ID. */
async function requestDeviceCode(
  clientId: string,
  tenantId: string,
): Promise<DeviceCodeResponse> {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/devicecode`;
  const body = new URLSearchParams({ client_id: clientId, scope: SCOPE });

  const res = await fetch(url, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dev Tunnels device-code request failed (${res.status}): ${text}`);
  }

  return (await res.json()) as DeviceCodeResponse;
}

/** Step 2: poll the token endpoint until the user completes sign-in. */
async function pollForToken(
  clientId: string,
  tenantId: string,
  deviceCode: string,
  interval: number,
): Promise<TokenResponse> {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: clientId,
    device_code: deviceCode,
  });

  let pollInterval = interval;

  for (;;) {
    await sleep(pollInterval * 1000);

    const res = await fetch(url, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const data = (await res.json()) as TokenResponse;

    if (data.access_token) return data;

    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      pollInterval += 5;
      continue;
    }
    if (data.error === 'expired_token') {
      throw new Error('Dev Tunnels sign-in timed out. Please try again.');
    }
    if (data.error === 'access_denied') {
      throw new Error('Dev Tunnels sign-in was denied.');
    }

    throw new Error(
      `Dev Tunnels token request failed: ${data.error ?? 'unknown'} — ${data.error_description ?? ''}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
