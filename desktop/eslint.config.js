import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * 桌面端 ESLint 配置（flat config）。
 *
 * 与 `apps/mobile/eslint.config.mjs` 同一设计原则：**只开零噪音的崩溃防护规则**，
 * 不做代码风格约束（风格交给 tsc --noEmit 与后续 Prettier）。
 *
 * 之所以先只开这两条：桌面端 3.2 万行代码此前完全没有 lint，任何「可能产生
 * 海量历史噪音」的规则一旦开启，CI 会立刻变红，最后的结果一定是把规则关掉。
 * 先建立能常绿的门槛，再逐步收紧，比一次开满更可持续。
 *
 * 这两条的价值在于它们命中的都是**运行时才会炸**的问题：
 *  - rules-of-hooks：hook 数量在不同渲染间不一致 → React 直接抛错
 *    （移动端历史案例：LyricView 的 "Rendered more hooks than during the previous render"）；
 *  - exhaustive-deps：过期闭包 → 播放器读到的 state 是上一帧的，
 *    表现为「切歌后还是旧歌的进度 / 音量不生效」这类难复现的问题。
 */
export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "src-tauri/**",
      "packages/*/dist/**",
      "vite.config.ts.timestamp-*",
      "*.config.js",
      "*.config.ts",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "packages/tauri-bridge/src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
