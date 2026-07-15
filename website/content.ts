export const site = {
  name: "Mobily",
  description:
    "Securely control live terminal sessions and Git workflows from your Android phone—without a Mobily-operated cloud.",
  command: "npx mobily --tunnel devtunnels",
  localCommand: "npx mobily --tunnel local",
  urls: {
    repository: "https://github.com/kirank55/mobily",
    releases: "https://github.com/kirank55/mobily/releases/latest",
    readme: "https://github.com/kirank55/mobily#readme",
    security:
      "https://github.com/kirank55/mobily/blob/main/docs/security-audit.md",
    license: "https://github.com/kirank55/mobily/blob/main/LICENSE",
  },
} as const;

export const navigation = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Security", href: "#security" },
  { label: "FAQ", href: "#faq" },
] as const;

export const trustPoints = [
  { mark: "MIT", label: "Open source" },
  { mark: "A", label: "Built for Android" },
  { mark: "KEY", label: "Hardware-backed keys" },
  { mark: "Ø", label: "No Mobily cloud" },
] as const;

export const features = [
  {
    eyebrow: "TERMINAL",
    title: "A real terminal in your pocket",
    description:
      "Stream a live xterm.js session with Ctrl, Alt, Esc, Tab, arrow keys, paste, and hardware-keyboard support.",
    mark: ">_",
  },
  {
    eyebrow: "SESSIONS",
    title: "Leave your desk, not your work",
    description:
      "Mobily uses tmux when it is available, keeping the same named Session alive across phone reconnects and CLI restarts.",
    mark: "∞",
  },
  {
    eyebrow: "ALERTS",
    title: "Know when the terminal needs you",
    description:
      "Connection state, recent terminal output, and prompts that need attention stay visible through an Android foreground notification.",
    mark: "!",
  },
  {
    eyebrow: "GIT",
    title: "Handle the small Git moments",
    description:
      "Review changes, inspect large diffs, stage or unstage files, switch branches, and commit without typing raw Git commands.",
    mark: "±",
  },
  {
    eyebrow: "STATIONS",
    title: "Move between your machines",
    description:
      "Keep multiple paired Stations on your phone and switch between workstations without scanning the QR code again.",
    mark: "02",
  },
  {
    eyebrow: "NETWORK",
    title: "Remote when needed. Local when possible.",
    description:
      "Use Dev Tunnels away from home or pinned TLS on the same Wi-Fi network. The transport is explicit and replaceable.",
    mark: "↗",
  },
] as const;

export const steps = [
  {
    number: "01",
    title: "Start a Session",
    description:
      "Run Mobily from your project. It starts or attaches to a persistent Session and opens the selected secure transport.",
  },
  {
    number: "02",
    title: "Scan once",
    description:
      "Scan the terminal QR code. Your phone creates a Device Key and pairs it to this Station with a one-time code.",
  },
  {
    number: "03",
    title: "Keep moving",
    description:
      "Use the terminal and Git controls from Android. Reconnect to the same Session whenever the network changes.",
  },
] as const;

export const gallery = [
  {
    src: "/product/stations.webp",
    alt: "Mobily Stations screen showing paired workstations and connection status",
    label: "Stations",
    description: "Your paired workstations, ready when you are.",
  },
  {
    src: "/product/terminal.webp",
    alt: "Mobily terminal screen connected to a workstation with live development output",
    label: "Live terminal",
    description: "The same Session, shaped for a phone.",
  },
  {
    src: "/product/git.webp",
    alt: "Mobily Git screen showing changed files and staging controls",
    label: "Native Git",
    description: "Review and move changes forward without command gymnastics.",
  },
] as const;

export const securityPoints = [
  {
    title: "The private key stays on your phone",
    description:
      "Every Station pairing uses a Device Key created in Android Keystore. The CLI only receives the public key.",
  },
  {
    title: "Reconnects prove device identity",
    description:
      "The Station sends a fresh challenge and accepts the connection only after the phone signs it successfully.",
  },
  {
    title: "No Mobily-operated relay",
    description:
      "Remote access uses Microsoft Dev Tunnels; local access uses a Station certificate with a pinned SHA-256 identity.",
  },
] as const;

export const faqs = [
  {
    question: "Is Mobily Android-only?",
    answer:
      "Yes. The current mobile client targets Android. The workstation CLI runs on Node.js 20+ across macOS, Linux, Windows, and WSL, subject to native PTY support.",
  },
  {
    question: "Does Mobily only work with AI coding agents?",
    answer:
      "No. Mobily streams a normal terminal Session, so it works with shells, editors, build tools, coding agents, and other terminal-based development workflows.",
  },
  {
    question: "Does my terminal pass through a Mobily cloud?",
    answer:
      "No Mobily-operated cloud exists. Choose Dev Tunnels for remote access or pinned TLS for an account-free connection on the same local network.",
  },
  {
    question: "Will my Session survive a disconnect?",
    answer:
      "Yes. With tmux, the named Session survives phone disconnects and CLI restarts. Without tmux, the bare PTY survives phone disconnects while the CLI process remains alive.",
  },
  {
    question: "Do I need tmux?",
    answer:
      "No. Mobily falls back to a bare PTY when tmux is unavailable, while clearly explaining the reduced persistence and workstation-sharing behavior.",
  },
  {
    question: "How do Android updates work?",
    answer:
      "The beta is distributed as a signed APK through GitHub Releases. Download the newest release and install it over the existing app when an update is available.",
  },
] as const;
