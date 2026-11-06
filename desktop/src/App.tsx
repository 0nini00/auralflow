import { Suspense, useEffect, useState, type ReactNode } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { setupPlayerSync } from "./stores/playerSync";
import { tryGetCurrentWindow } from "./utils/appWindow";
import { detectWindowRoleFromParts, type AppWindowRole } from "./utils/windowRole";
import { windowComponents, windowScopes } from "./windowModules";

/**
 * 一个窗口 = 一套错误边界 + 懒加载兜底。
 *
 * 边界套在 Suspense 外面：窗口界面模块（见 windowModules.ts）拉取失败会以错误形式
 * 冒到边界上，界面给出可见的失败原因，而不是把窗口留成一片空白。
 */
function WindowShell({ role, children }: { role: AppWindowRole; children: ReactNode }) {
  return (
    <ErrorBoundary scope={windowScopes[role]}>
      <Suspense fallback={null}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function App() {
  const [role, setRole] = useState<AppWindowRole | null>(null);

  useEffect(() => {
    const resolveRole = () => {
      // 非 Tauri 环境（浏览器里的纯 UI 调试）读不到窗口标签，按主窗口处理。
      const label = tryGetCurrentWindow()?.label ?? "";
      const nextRole = detectWindowRoleFromParts(label, window.location.hash);
      if (nextRole !== "lyric-unlock") {
        setupPlayerSync(nextRole);
      }
      setRole(nextRole);
    };
    const onHashChange = () => resolveRole();
    resolveRole();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (!role) return null;
  const WindowContent = windowComponents[role];
  return (
    <WindowShell role={role}>
      <WindowContent />
    </WindowShell>
  );
}

export default App;
