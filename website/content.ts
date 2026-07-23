export const site = {
  name: 'Mobily',
  description:
    'Never waste your time in a coding session. Control the live terminal on your PC from Android—through a secure tunnel, without routing your work through a Mobily-operated cloud.',
  command: 'npx mobily --tunnel devtunnels',
  localCommand: 'npx mobily --tunnel local',
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
  { label: 'Transport', detail: 'Local or remote', mark: '↗' },
] as const;

export const problemSolution = {
  index: '00',
  label: 'WHY MOBILY',
  eyebrow: 'THE PROBLEM',
  question: 'Tired of sitting at your PC, staring at the screen while an agent does the work?',
  answerMark: 'THE FIX',
  answer:
    'Use Mobily. Keep the live terminal on your phone—leave the desk without missing the session.',
} as const;

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
      'Keep connection state, recent output, and prompts visible through an Android foreground notification.',
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
    description: 'Choose Dev Tunnels away from the desk or pinned TLS on the same Wi-Fi network.',
    meta: 'LAN / REMOTE',
  },
] as const;

export const securityFlow = [
  { label: 'PC', detail: 'Your PC', mark: '>_' },
  { label: 'Secure transport', detail: 'Dev Tunnel or pinned LAN TLS', mark: 'TLS' },
  { label: 'Android', detail: 'Device Key in Android Keystore', mark: 'KEY' },
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
      'Remote access currently uses Microsoft Dev Tunnels. Same-network access uses a PC certificate with a pinned SHA-256 identity.',
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
      'No Mobily-operated cloud exists. Remote access currently uses Microsoft Dev Tunnels; local access uses pinned TLS directly between devices on the same network.',
  },
  {
    question: 'What survives a disconnect?',
    answer:
      'A tmux-backed Session can survive phone disconnects and CLI restarts. The bare PTY fallback survives phone disconnects only while the CLI process remains alive.',
  },
  {
    question: 'Do I need an account?',
    answer:
      'First-time Dev Tunnels setup may ask you to sign in with GitHub or Microsoft. The same-Wi-Fi pinned-TLS mode is account-free.',
  },
  {
    question: 'How do Android updates work?',
    answer:
      'Signed beta APKs are published through GitHub Releases. Install the latest build over the existing app when an update is available.',
  },
] as const;
