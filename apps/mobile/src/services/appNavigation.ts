/**
 * 嵌套页面返回按钮的可见性判定。
 *
 * 本模块此前还导出了一整套底部标签模型（`APP_TABS`、`APP_SETTINGS_TAB`、
 * `DEFAULT_APP_TAB`、`getNextAppTab`、`openPlayerTab`、`isVisibleTabId` 以及
 * `AppTabId` / `VisibleTabId` / `AppTabIconKey` / `AppTabItem` 类型），
 * 但那批导出在移动端没有任何调用方。真实的底部标签定义在
 * `src/navigation/MainTabNavigator.tsx`，为避免形成第二份真相源，该模型已删除。
 * 本模块的导入路径 `@/services/appNavigation` 保持不变。
 */

export function shouldShowNestedBackButton(onBack: unknown): boolean {
  return typeof onBack === "function";
}
