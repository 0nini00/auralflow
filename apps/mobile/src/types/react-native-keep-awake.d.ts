declare module "react-native-keep-awake" {
  import type { ComponentType } from "react";

  /**
   * 挂载时保持屏幕常亮，卸载时若无可恢复则关闭。
   * 也可通过静态 activate()/deactivate() 显式控制。
   */
  const KeepAwake: ComponentType<Record<string, unknown>> & {
    activate: () => void;
    deactivate: () => void;
  };

  export default KeepAwake;
}
