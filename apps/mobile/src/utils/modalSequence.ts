/**
 * 连续弹层的时序工具。
 *
 * 背景：Android 上每个 `<Modal>` 都是一个独立的 Dialog 窗口。若在「A 关闭动画
 * 还在播」的同一帧里挂载 B，B 会落在仍持有焦点的旧窗口之后 —— 视觉上 B 已经
 * 显示出来了，但点击穿透不到它（表现为「点空白区域关不掉」）。
 *
 * 因此「在一个弹层里唤起另一个弹层」时，必须先让前者收完动画。
 * 这个时长与 react-native Modal 的 slide 动画一致（约 300ms）。
 */
export const MODAL_DISMISS_MS = 320;

/** 等上一个弹层关闭后再执行（用于「菜单 → 子弹层」这类串联） */
export function afterModalDismiss(action: () => void): void {
  setTimeout(action, MODAL_DISMISS_MS);
}
