import { parseArgs } from 'node:util';

import { UserFacingError } from './errors.js';
import { defaultBindingFile, FileBindingRepository } from './bindings.js';
import { isDevTunnelsProvider, type DevTunnelsProvider } from './tunnel/devtunnels.js';
import {
  exitCurrentMobily,
  hideCurrentQrPanel,
  killTmuxSession,
  validateSessionName,
} from './sessionBackend/factory.js';
import { formatCliHelp } from './cliHelp.js';

export interface RunStationOptions {
  devtunnelsProvider?: DevTunnelsProvider;
  verbose: boolean;
  requestedSessionName?: string;
}

export type CliParseResult = { kind: 'done' } | { kind: 'run'; options: RunStationOptions };

export function parseCliArgs(
  argv: readonly string[],
  version: string,
): CliParseResult {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      'devtunnels-provider': { type: 'string' },
      verbose: { type: 'boolean', default: false },
      'list-bindings': { type: 'boolean', default: false },
      'revoke-binding': { type: 'string' },
      session: { type: 'string' },
      'kill-session': { type: 'string' },
    },
  });

  if (values.help) {
    console.log(formatCliHelp(version));
    return { kind: 'done' };
  }

  if (positionals[0] === 'exit') {
    if (!exitCurrentMobily()) {
      throw new UserFacingError("'mobily exit' must be run inside an attached tmux terminal.");
    }
    return { kind: 'done' };
  }

  if (positionals[0] === 'qr') {
    const action = positionals[1];
    if (action !== 'hide' && action !== 'clear') {
      throw new UserFacingError("Use 'mobily qr hide' or 'mobily qr clear'.");
    }
    if (!hideCurrentQrPanel()) throw new UserFacingError('No Mobily QR panel is visible.');
    if (action === 'clear') process.stdout.write('\u001b[2J\u001b[3J\u001b[H');
    return { kind: 'done' };
  }

  if (values['kill-session']) {
    const name = validateSessionName(values['kill-session']);
    killTmuxSession(name);
    console.log(`Terminated tmux session: ${name}`);
    return { kind: 'done' };
  }

  const bindingRepository = new FileBindingRepository(defaultBindingFile());
  if (values['list-bindings']) {
    const bindings = bindingRepository.list();
    if (bindings.length === 0) {
      console.log('No Device Key bindings are stored on this Station.');
    } else {
      for (const binding of bindings) {
        console.log(
          `${binding.deviceBindingId}\t${binding.stationName}\t${binding.pairedAt.toISOString()}`,
        );
      }
    }
    return { kind: 'done' };
  }

  if (values['revoke-binding']) {
    if (!bindingRepository.revoke(values['revoke-binding'])) {
      throw new UserFacingError(`No Device Key binding found: ${values['revoke-binding']}`);
    }
    console.log(`Revoked Device Key binding: ${values['revoke-binding']}`);
    return { kind: 'done' };
  }

  const providerFlag = values['devtunnels-provider'];
  let devtunnelsProvider: DevTunnelsProvider | undefined;
  if (providerFlag !== undefined) {
    if (!isDevTunnelsProvider(providerFlag)) {
      throw new UserFacingError(
        `Unknown Dev Tunnels provider: '${providerFlag}'. Use 'github' or 'microsoft'.`,
      );
    }
    devtunnelsProvider = providerFlag;
  }

  return {
    kind: 'run',
    options: {
      devtunnelsProvider,
      verbose: values.verbose,
      requestedSessionName: values.session ? validateSessionName(values.session) : undefined,
    },
  };
}
