/**
 * 底部弹层（bottom sheet）共用的几何与遮罩。
 *
 * 统一前这些值散落在 8 个组件里：遮罩有 0.45 与 0.5 两种、圆角写了 20 的
 * 字面量、拉手尺寸各写一遍。结果是同一个 app 里「弹层」长得不完全一样，
 * 而且改一处不会传导到别处。
 *
 * 面板底色不在这里——它必须跟随主题，取 palette.surface。
 * 特别注意：不要用 palette.background 当弹层底色，那是页面底色，
 * 在深色主题下比 surface 更黑，看起来会像「另一个 app 的弹窗」。
 */
export const sheet = {
  /** 遮罩：唯一取值，不要再写 0.5 / 0.6 */
  scrim: "rgba(0, 0, 0, 0.45)",
  /** 顶部圆角 */
  radius: 20,
  /** 拉手 */
  handleWidth: 36,
  handleHeight: 4,
  handleRadius: 2,
  handlePaddingVertical: 10,
  /** 面板底部内边距下限（与安全区取较大者） */
  bottomInsetMin: 16,
} as const;
