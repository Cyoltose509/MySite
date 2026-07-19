'use client';

import { usePrivateAccess } from '@/lib/private';

/**
 * 空渲染的桥接组件：仅用于在每页加载时执行 lib/private 模块，
 * 从而把 unlockPrivate / lockPrivate / privateStatus 三个控制台命令挂到 window，
 * 并保证跨标签页的隐私解锁/锁定事件被监听。
 */
export default function PrivateBridge() {
  usePrivateAccess();
  return null;
}
