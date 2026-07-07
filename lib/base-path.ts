/**
 * 运行时获取 basePath（GitHub Pages 项目站点需要 /MySite 前缀）
 * 本地开发返回 ''，线上如果在 /MySite/ 下则返回 '/MySite'
 */
export function getBasePath(): string {
  if (typeof window === 'undefined') return '';
  const path = window.location.pathname;
  // 如果路径以 /MySite/ 开头，说明在 GitHub Pages 项目站点
  if (path.startsWith('/MySite/')) return '/MySite';
  // 如果路径就是 /MySite，也返回 /MySite
  if (path === '/MySite') return '/MySite';
  return '';
}

/**
 * 获取带 basePath 的完整 URL
 */
export function withBasePath(url: string): string {
  if (!url.startsWith('/')) return url;
  const bp = getBasePath();
  return bp ? `${bp}${url}` : url;
}
