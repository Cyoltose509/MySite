import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DataHub · 个人数据中枢',
  description: '个人数据分析与展示系统',
  icons: {
    icon: '/avatar.png',
    shortcut: '/avatar.png',
    apple: '/avatar.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <head>
        {/* Fix favicon path for GitHub Pages (basePath) */}
        <script dangerouslySetInnerHTML={{
          __html: `
            (function() {
              var base = '';
              var path = window.location.pathname;
              // Detect if we're under a subpath like /MySite/
              var m = path.match(/^(\\/[^/]+\\/)/);
              if (m && path !== m[1] && !path.startsWith(m[1] + '_next')) {
                // We're at the root, check if there's a basePath
              }
              // Simply check if /MySite/avatar.png works
              var links = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
              if (links.length && !document.querySelector('link[href*="/MySite/"]')) {
                // Only fix if we're actually on GitHub Pages (path contains /MySite/)
                if (window.location.pathname.startsWith('/MySite/')) {
                  links.forEach(function(l) {
                    var href = l.getAttribute('href');
                    if (href && href.startsWith('/') && !href.startsWith('/MySite/')) {
                      l.setAttribute('href', '/MySite' + href);
                    }
                  });
                }
              }
            })();
          `
        }} />
      </head>
      <body style={{
        margin: 0, padding: 0, background: '#0a0a14', color: '#e4e4e7',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif',
        WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale', lineHeight: 1.6,
      }}>
        {children}
      </body>
    </html>
  );
}
