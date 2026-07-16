import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@lx/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      // 真实 react-native 源码含 Flow `import typeof` 语法，vite SSR transform 无法解析，
      // 会导致触碰 store/service 的 suite 加载崩溃。单元测试不渲染组件，统一替换为轻量 stub。
      "react-native": fileURLToPath(new URL("./test/react-native.stub.ts", import.meta.url)),
    },
  },
});