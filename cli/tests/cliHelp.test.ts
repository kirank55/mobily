import { describe, expect, it } from 'vitest';
import { formatCliHelp } from '../src/cliHelp.js';

describe('formatCliHelp()', () => {
  it('prints a short guide for workstation controls and common commands', () => {
    const help = formatCliHelp('0.0.0');
    expect(help).toContain('mobily v0.0.0');
    expect(help).toContain('mobily exit');
    expect(help).toContain('mobily qr hide');
    expect(help).toContain('mobily                             Secure remote access (Dev Tunnels)');
    expect(help).toContain('mobily --list-bindings');
    expect(help).toContain('mobily --version');
    expect(help).toContain('mobily --verbose');
    expect(help).toContain('mobily --devtunnels-provider github|microsoft');
    expect(help.split('\n').length).toBeGreaterThan(5);
    expect(help.split('\n').length).toBeLessThan(35);
  });
});
