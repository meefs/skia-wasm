import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Provider } from '@/components/provider';
import { appDescription, appName } from '@/lib/shared';
import './global.css';

const inter = Inter({
  subsets: ['latin'],
});

// The origin of the published site, for the absolute URLs of social cards.
const siteUrl = process.env.DOCS_SITE_URL;

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  title: {
    template: `%s | ${appName}`,
    default: appName,
  },
  description: appDescription,
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
