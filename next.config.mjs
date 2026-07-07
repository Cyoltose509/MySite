/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

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
