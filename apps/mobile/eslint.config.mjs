import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * 移动端 ESLint 配置（flat config）。
 *
 * 设计目标：最小化、零噪音的「崩溃防护」——
 * 只启用 React Hooks 规则，因为 hooks 写在条件 return 之后 / 条件分支内
 * 会在渲染路径上产生 hook 数量不一致，导致 React 抛错崩溃
 * （历史案例：LyricView 的 "Rendered more hooks than during the previous render"）。
 *
 * 其余代码风格/未使用变量等交给 TypeScript 编译器（tsc --noEmit）把关，
 * 本配置刻意不开启任何可能产生海量历史噪音的规则。
 */
export default [
  {
    ignores: [
      "node_modules/**",
      "android/**",
      "ios/**",
      "babel.config.js",
      "metro.config.js",
      "index.js",
      "shim.js",
      "*.bundle.js",
      "*.bundle",
    ],
  },
  {
    // 注意：App.tsx 位于 src/ 之外（应用根目录），必须显式纳入，
    // 否则根组件的 hook 顺序错误会被漏检（review 发现的实际缺口）。
    files: ["src/**/*.{ts,tsx}", "App.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      // 核心防线：Hook 必须在组件顶层无条件调用。
      // 违反（条件 return 之后的 hook、if/循环/三元分支内的 hook）→ 构建失败。
      "react-hooks/rules-of-hooks": "error",
      // 依赖完整性：useEffect/useCallback/useMemo 缺失依赖会导致过期闭包。
      // 先以 warn 起步不阻塞 CI，逐步清零后升为 error。
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
