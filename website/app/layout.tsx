import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Geist } from 'next/font/google';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';
import { site } from '@/content';

const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F3F0E8',
  colorScheme: 'light',
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3000';
  const protocol =
    requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${protocol}://${host}`;
  const socialImage = `${origin}/og.png`;

  return {
    title: 'Mobily — Never miss a coding session',
    description: site.description,
    applicationName: site.name,
    keywords: [
      'remote terminal',
      'Android terminal',
      'mobile developer tools',
      'tmux remote',
      'Git Android',
      'open source terminal',
    ],
    authors: [{ name: 'Mobily', url: site.urls.repository }],
    creator: 'Mobily',
    icons: {
      icon: '/favicon.png',
      shortcut: '/favicon.png',
      apple: '/apple-touch-icon.png',
    },
    openGraph: {
      type: 'website',
      siteName: site.name,
      title: 'Never miss a coding session.',
      description: site.description,
      images: [
        {
          url: socialImage,
          width: 1536,
          height: 1024,
          alt: 'Mobily — Never miss a coding session',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Never miss a coding session.',
      description: site.description,
      images: [socialImage],
    },
    robots: { index: true, follow: true },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
