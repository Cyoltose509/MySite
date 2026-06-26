/** @type {import('next').NextConfig} */
const isProd = process.env.GITHUB_ACTIONS === 'true';
const basePath = isProd ? '/MySite' : '';

const nextConfig = {
  output: 'export',
  // GitHub Pages 部署在 /MySite/ 子目录下，需要设置 basePath
  // 本地开发时为空，CI 构建时设为 /MySite
  basePath: basePath,
  assetPrefix: isProd ? '/MySite/' : '',
  images: {
    unoptimized: true,
  },
  distDir: 'out',
  // 注入到客户端的全局变量（NEXT_PUBLIC_ 前缀的变量会被内联）
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
