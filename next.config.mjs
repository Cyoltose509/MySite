/** @type {import('next').NextConfig} */
const isProd = process.env.GITHUB_ACTIONS === 'true';

const nextConfig = {
  output: 'export',
  // GitHub Pages 部署在 /MySite/ 子目录下，需要设置 basePath
  // 本地开发时为空，CI 构建时设为 /MySite
  basePath: isProd ? '/MySite' : '',
  assetPrefix: isProd ? '/MySite/' : '',
  images: {
    unoptimized: true,
  },
  distDir: 'out',
};

export default nextConfig;
