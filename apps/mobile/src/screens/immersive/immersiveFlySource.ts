/**
 * 播放页「封面飞入/飞回」转场的起点坐标：迷你播放栏封面在窗口中的位置。
 *
 * PlayerBar 挂载/布局变化时测量写入（measureInWindow），沉浸页打开时读取一次。
 * 单例即可——迷你栏与 push 页底栏同一时刻只有一个可见，后写者即当前可见者。
 */
export interface ImmersiveFlyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

let flySourceRect: ImmersiveFlyRect | null = null;

export function setImmersiveFlySource(rect: ImmersiveFlyRect): void {
  flySourceRect = rect;
}

export function getImmersiveFlySource(): ImmersiveFlyRect | null {
  return flySourceRect;
}
