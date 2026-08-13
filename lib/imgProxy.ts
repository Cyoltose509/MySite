// 图片代理 URL：把第三方图床封面转成 Supabase 同源、带 CORS 的流
// 用于前端 canvas 导出（html-to-image）时内联封面，避免跨域污染。
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

export function proxyCoverUrl(src: string): string {
  return `${SUPABASE_URL}/functions/v1/img-proxy?u=${encodeURIComponent(src)}`;
}
