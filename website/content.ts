export const site = {
  name: 'Mobily',
  description:
    'Never waste your time in a coding session. Control the live terminal on your PC from Android—through a secure tunnel, without routing your work through a Mobily-operated cloud.',
  command: 'npx mobily',
  urls: {
    repository: 'https://github.com/kirank55/mobily',
    releases: 'https://github.com/kirank55/mobily/releases/latest',
    readme: 'https://github.com/kirank55/mobily#readme',
    security: 'https://github.com/kirank55/mobily/blob/main/SECURITY.md',
    license: 'https://github.com/kirank55/mobily/blob/main/LICENSE',
  },
} as const;

export const navigation = [
  { label: 'Workflow', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
  { label: 'Security', href: '#security' },
  { label: 'FAQ', href: '#faq' },
] as const;

export const proofPoints = [
  { label: 'Live xterm', detail: 'Full key support', mark: '>_' },
  { label: 'Device Key', detail: 'Android Keystore', mark: 'KEY' },
  { label: 'Session', detail: 'tmux when available', mark: '∞' },
  { label: 'Transport', detail: 'Dev Tunnels', mark: '↗' },
] as const;

export const workflow = [
  {
    id: 'pair',
    number: '01',
    eyebrow: 'PAIR ONCE',
    title: 'Bind your phone to the terminal.',
    description:
      'Scan the one-time QR code. Mobily creates a Device Key in Android Keystore and sends only its public key to the CLI.',
    src: '/product/pairing.webp',
    alt: "Mobily's secure one-time QR pairing screen on Android",
    status: 'ONE-TIME CODE',
  },
  {
    id: 'terminal',
    number: '02',
    eyebrow: 'KEEP IT LIVE',
    title: 'Return to the same visible terminal.',
    description:
      'Receive the current Session Snapshot, send input, use special keys, and answer a waiting prompt from Android.',
    src: '/product/terminal.webp',
    alt: 'A live Mobily terminal Session showing passing tests on Android',
    status: 'SESSION LIVE',
  },
  {
    id: 'stations',
    number: '03',
    eyebrow: 'MOVE BETWEEN',
    title: 'Keep every paired PC close.',
    description:
      'Switch among terminals on your PC, cloud machine, home server, or laptop without scanning the pairing code again.',
    src: '/product/stations.webp',
    alt: 'Mobily showing multiple paired PCs and terminals and their status',
    status: 'PAIRED PCS',
  },
  {
    id: 'git',
    number: '04',
    eyebrow: 'CLOSE THE LOOP',
    title: 'Handle the small Git moments natively.',
    description:
      'Review diffs, stage or unstage files, switch local branches, and commit from a phone-sized interface.',
    src: '/product/git.webp',
    alt: 'Mobily Git workflow showing changed files, staging actions, and a code diff',
    status: 'GIT READY',
  },
] as const;

export const features = [
  {
    mark: '>_',
    title: 'Terminal',
    description:
      'A live xterm.js Session with Ctrl, Alt, Esc, Tab, arrows, paste, and hardware-keyboard support.',
    meta: 'LIVE INPUT',
  },
  {
    mark: '∞',
    title: 'Persistence',
    description:
      'Use tmux when available. Without it, the bare PTY survives phone disconnects only while the CLI stays alive.',
    meta: 'TMUX / PTY',
  },
  {
    mark: '!',
    title: 'Alerts',
    description:
      'Keep session progress, recent output, and prompts visible through an Android foreground notification.',
    meta: 'BACKGROUND',
  },
  {
    mark: '±',
    title: 'Git',
    description:
      'Inspect large diffs, stage or unstage, switch branches, and commit without typing raw Git commands.',
    meta: 'NATIVE CONTROL',
  },
  {
    mark: '02',
    title: 'PCs',
    description:
      'Keep multiple PCs paired on one phone—and reach terminals on cloud machines the same way—without re-pairing.',
    meta: 'MULTI-PC',
  },
  {
    mark: '↗',
    title: 'Transport',
    description: 'Reach your PC from anywhere through Microsoft Dev Tunnels.',
    meta: 'DEV TUNNELS',
  },
] as const;

export const securityPoints = [
  {
    title: 'The private key stays on the phone.',
    description:
      "The CLI receives the Device Key's public key, never the non-exportable private key created by Android Keystore.",
  },
  {
    title: 'Reconnects prove device identity.',
    description:
      'Your PC sends a fresh challenge and opens the Session only after Android signs it successfully.',
  },
  {
    title: 'Mobily operates no relay.',
    description:
      'Remote access uses Microsoft Dev Tunnels. Mobily does not operate a relay of its own.',
  },
] as const;

export const faqs = [
  {
    question: 'Is Mobily Android-only?',
    answer:
      'The mobile client currently targets Android. The CLI on your PC runs on Node.js 20+ across macOS, Linux, Windows, and WSL, subject to native PTY support.',
  },
  {
    question: 'Does Mobily only work with coding agents?',
    answer:
      'No. Mobily carries a normal terminal Session, so it works with shells, build tools, editors, coding agents, and other terminal-based workflows.',
  },
  {
    question: 'Does my terminal pass through a Mobily cloud?',
    answer:
      'No Mobily-operated cloud exists. Access currently uses Microsoft Dev Tunnels between your PC and phone.',
  },
  {
    question: 'What survives a disconnect?',
    answer:
      'A tmux-backed Session can survive phone disconnects and CLI restarts. The bare PTY fallback survives phone disconnects only while the CLI process remains alive.',
  },
  {
    question: 'Do I need an account?',
    answer:
      'First-time Dev Tunnels setup may ask you to sign in with GitHub or Microsoft. The phone never needs a Microsoft account.',
  },
  {
    question: 'How do Android updates work?',
    answer:
      'Build the Expo app from this repository (`pnpm --filter mobily-android android` or EAS). Tagged releases publish the CLI to npm only; no signed APK artifact is published yet.',
  },
] as const;
