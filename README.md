# Personal Data Hub

个人数据中枢系统 - 记录、同步、分析个人数据

## 功能

- 📊 公开仪表盘（所有人可访问）
- 🔒 隐藏管理后台（仅作者本人）
- 🎬 番剧数据同步（GitHub Pages）
- 🎵 网易云音乐同步（Playlist API）
- 🧠 心情记录与趋势分析

## 技术栈

- **前端**: Next.js 14 (App Router, Static Export)
- **后端**: Supabase (PostgreSQL)
- **图表**: Recharts
- **样式**: Tailwind CSS (Dark Mode)
- **部署**: GitHub Pages

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.local.example` 到 `.env.local` 并填写：

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
NEXT_PUBLIC_DEV_MODE=true  # 开发模式跳过登录
```

### 3. 设置 Supabase 数据库

1. 创建 Supabase 项目
2. 在 SQL Editor 中运行 `supabase/schema.sql`
3. 密码哈希已预填入（SHA-256 of `zs235711131719`）

### 4. 运行开发服务器

```bash
npm run dev
```

访问 `http://localhost:3000`

### 5. 构建静态文件

```bash
npm run build
```

输出在 `out/` 目录。

## 部署到 GitHub Pages

### 手动部署

```bash
npm run build
# 将 out/ 目录内容推送到 gh-pages 分支
```

### 自动部署

推送代码到 `main` 分支，GitHub Actions 会自动构建并部署。

## 页面

| 路径 | 说明 |
|------|------|
| `/` | 公开仪表盘 |
| `/login` | 管理员登录 |
| `/admin` | 管理后台 |

## 默认密码

SHA-256 hash of: `zs235711131719`

Pre-computed hash: `cbd18d53aa6492b8d99df6aa9df4858d70e85db6630fb6b1c43af5fdbc85d1b7`

## 数据库 Schema

详见 `supabase/schema.sql`，包含：

- `anime_list` - 番剧数据
- `music_list` - 音乐数据
- `music_tags` - 音乐语义标签
- `mood_logs` - 心情记录
- `admin_config` - 管理员密码哈希
- RLS 策略
- RPC 函数（同步、标签、心情记录）

## 注意事项

- 静态导出模式下，所有数据操作通过 Supabase 客户端完成
- 管理员认证使用 SHA-256 哈希，哈希值存储在客户端 localStorage
- Supabase RLS 作为最终权限控制
