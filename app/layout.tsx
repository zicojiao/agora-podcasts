import type { Metadata, Viewport } from 'next';
import { Fraunces, IBM_Plex_Mono, Nunito_Sans } from 'next/font/google';
import './globals.css';

const display = Fraunces({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-display' });
const body = Nunito_Sans({ subsets: ['latin'], weight: ['400', '600', '700', '800'], variable: '--font-body' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

const TITLE = 'Agora Podcasts — a broadcast you can interact with';
const DESCRIPTION = 'Turn any text into a two-host live show. Join the broadcast, ask the hosts a question, then keep listening.';

export const metadata: Metadata = {
  metadataBase: new URL('https://agora-podcasts.vercel.app'),
  title: TITLE,
  description: DESCRIPTION,
  icons: {
    icon: '/brand/agora-podcasts-logo.png',
    apple: '/brand/agora-podcasts-logo.png',
  },
  // Shared room links are opened straight from chat apps, so give them a real preview card.
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    siteName: 'Agora Podcasts',
    images: [
      {
        url: '/og/agora-podcasts-og.png',
        width: 1200,
        height: 630,
        alt: 'Agora Podcasts — a broadcast you can interact with.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og/agora-podcasts-og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`h-full ${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body className="h-full min-h-screen font-body">{children}</body>
    </html>
  );
}
