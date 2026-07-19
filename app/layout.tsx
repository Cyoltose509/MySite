import type { Metadata } from 'next';
import './globals.css';
import PrivateBridge from '@/components/PrivateBridge';

export async function generateMetadata(): Promise<Metadata> {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return {
    title: 'DataHub · 个人数据中枢',
    description: '个人数据分析与展示系统',
    icons: {
      icon: `${basePath}/avatar.png`,
      shortcut: `${basePath}/avatar.png`,
      apple: `${basePath}/avatar.png`,
    },
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <body style={{
        margin: 0, padding: 0, background: '#0a0a14', color: '#e4e4e7',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif',
        WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale', lineHeight: 1.6,
      }}>
        {children}
        <PrivateBridge />
      </body>
    </html>
  );
}
