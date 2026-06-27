/** @type {import('next').NextConfig} */
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const basePath = isCI ? '/MySite' : '';

const nextConfig = {
  output: 'export',
  basePath: basePath || undefined,
  assetPrefix: basePath ? basePath + '/' : undefined,
  images: {
    unoptimized: true,
  },
  distDir: 'out',
};

export default nextConfig;
