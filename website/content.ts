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
  { label: "Experience", href: "#how-it-works" },
  { label: "Security", href: "#security" },
  { label: "FAQ", href: "#faq" },
] as const;

export const trustPoints = [
  { mark: "MIT", label: "Open source" },
  { mark: "APK", label: "Built for Android" },
  { mark: "KEY", label: "Android Device Keys" },
  { mark: "Ø", label: "No Mobily cloud" },
] as const;

export const features = [
  {
    eyebrow: "TERMINAL",
    title: "A real terminal in your pocket",
    description:
      "Stream a live xterm.js session with Ctrl, Alt, Esc, Tab, arrow keys, paste, and hardware-keyboard support.",
    mark: ">_",
    layout: "wide",
    metric: "LIVE",
  },
  {
    eyebrow: "SESSIONS",
    title: "Leave your desk, not your work",
    description:
      "Mobily uses tmux when it is available, keeping the same named Session alive across phone reconnects and CLI restarts.",
    mark: "∞",
    layout: "standard",
    metric: "TMUX",
  },
  {
    eyebrow: "ALERTS",
    title: "Know when the terminal needs you",
    description:
      "Connection state, recent terminal output, and prompts that need attention stay visible through an Android foreground notification.",
    mark: "!",
    layout: "standard",
    metric: "READY",
  },
  {
    eyebrow: "GIT",
    title: "Handle the small Git moments",
    description:
      "Review changes, inspect large diffs, stage or unstage files, switch branches, and commit without typing raw Git commands.",
    mark: "±",
    layout: "tall",
    metric: "04 FILES",
  },
  {
    eyebrow: "STATIONS",
    title: "Move between your machines",
    description:
      "Keep multiple paired Stations on your phone and switch between workstations without scanning the QR code again.",
    mark: "02",
    layout: "standard",
    metric: "MULTI",
  },
  {
    eyebrow: "NETWORK",
    title: "Remote when needed. Local when possible.",
    description:
      "Use Dev Tunnels away from home or pinned TLS on the same Wi-Fi network. The transport is explicit and replaceable.",
    mark: "↗",
    layout: "wide",
    metric: "LAN / WAN",
  },
] as const;

export const productStory = [
  {
    id: "pair",
    number: "01",
    eyebrow: "PAIR ONCE",
    title: "One scan creates the trust line.",
    description:
      "Run Mobily in your project, point Android at the one-time QR code, and bind a Device Key to this Station—without creating an account.",
    src: "/product/pairing.webp",
    alt: "Mobily's secure one-time QR pairing screen on Android",
    status: "ONE-TIME CODE",
  },
  {
    id: "terminal",
    number: "02",
    eyebrow: "STAY LIVE",
    title: "The Session follows, not the laptop.",
    description:
      "Return to the same terminal output, send the keys developers actually need, and answer a waiting prompt from anywhere your secure transport reaches.",
    src: "/product/terminal.webp",
    alt: "A live Mobily terminal Session showing passing tests on Android",
    status: "CONNECTED",
  },
  {
    id: "stations",
    number: "03",
    eyebrow: "MOVE BETWEEN",
    title: "Every machine stays within reach.",
    description:
      "Keep several paired Stations on one phone and move between a workstation, devbox, home server, or travel laptop without pairing again.",
    src: "/product/stations.webp",
    alt: "Mobily Stations showing multiple paired developer machines and their status",
    status: "4 STATIONS",
  },
  {
    id: "git",
    number: "04",
    eyebrow: "CLOSE THE LOOP",
    title: "Handle the small Git moments natively.",
    description:
      "Inspect changed files and real diffs, stage or unstage work, switch branches, and commit without forcing desktop Git controls into a phone-sized terminal.",
    src: "/product/git.webp",
    alt: "Mobily Git workflow showing changed files, staging actions, and a code diff",
    status: "GIT READY",
  },
] as const;

export const securityFlow = [
  { label: "Station", detail: "Your workstation", mark: ">_" },
  { label: "Secure transport", detail: "Dev Tunnel or pinned LAN TLS", mark: "↗" },
  { label: "Android", detail: "Android Keystore Device Key", mark: "KEY" },
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
