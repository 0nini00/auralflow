import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** 队列项只取渲染所需的最少字段，播放队列的 MusicInfo 与沉浸页的队列 props 都能直接传入 */
export interface QueuePanelTrack {
  id: string | number;
  source: string;
  name: string;
  singer?: string;
}

/**
 * 类名按结构位拆开传入：沉浸页固定深色、迷你栏跟随主题，
 * 组件只保留结构与交互，配色与尺寸交给两套预设（见文件末尾）。
 */
export interface QueuePanelClasses {
  panel: string;
  header: string;
  list: string;
  item: string;
  /** 当前曲目的高亮修饰类，追加在 item 之后 */
  playing: string;
  play: string;
  index: string;
  info: string;
  remove: string;
  /** 空队列提示类名；不传则不渲染提示（沉浸页保持既有外观） */
  empty?: string;
}

export interface QueuePanelProps {
  tracks: ReadonlyArray<QueuePanelTrack>;
  currentIndex: number;
  play: (index: number) => void;
  remove: (index: number) => void;
  classes: QueuePanelClasses;
  /** 面板 id：沉浸页的 aria-controls 依赖 af-immersive-queue-panel */
  id?: string;
  /** 选中曲目后的收尾（通常是收起面板）；移除不触发，方便连续清理 */
  onClose?: () => void;
}

/** 当前播放队列面板：沉浸式播放页与底部迷你栏共用，差异全在 id 与 classes 上 */
export function QueuePanel({ tracks, currentIndex, play, remove, classes, id, onClose }: QueuePanelProps) {
  const currentItem = useRef<HTMLDivElement | null>(null);

  // 队列可能上百首，打开面板时先把当前曲滚进视野，用户才找得到「正在播的是哪首」
  useEffect(() => {
    if (currentIndex < 0) return;
    // 居中而不是 block:'nearest'：nearest 会把当前曲贴到列表下沿（用户要往上找），
    // 打开队列时最该先看到的是「正在播的是哪首」。
    const frame = window.requestAnimationFrame(() => currentItem.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    return () => window.cancelAnimationFrame(frame);
  }, [currentIndex, tracks.length]);

  return (
    <div id={id} className={classes.panel} role="dialog" aria-label="当前播放队列">
      <div className={classes.header}><strong>播放列表</strong><span>{tracks.length} 首</span></div>
      <div className={classes.list}>
        {tracks.length === 0 && classes.empty ? (
          <div className={classes.empty}>播放列表为空</div>
        ) : tracks.map((track, index) => (
          <div key={`${track.source}:${track.id}:${index}`} ref={index === currentIndex ? currentItem : undefined}
            className={`${classes.item}${index === currentIndex ? ` ${classes.playing}` : ''}`}>
            {/* 播放与移除是兄弟原生按钮，不做嵌套交互容器，键盘 Tab 才不会被整行吞掉 */}
            <button type="button" className={classes.play} aria-label={`播放 ${track.name}`}
              aria-current={index === currentIndex ? 'true' : undefined}
              onClick={() => { play(index); onClose?.(); }}>
              <span className={classes.index}>{index + 1}</span>
              <span className={classes.info}><strong>{track.name}</strong><span>{track.singer || '未知歌手'}</span></span>
            </button>
            <button type="button" className={classes.remove} onClick={() => remove(index)}
              aria-label={`从播放列表移除 ${track.name}`} data-tooltip="从播放列表移除" data-tooltip-placement="top-end"><X size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 沉浸页预设：沿用 af-immersive-* 类名，配色由 .af-immersive-popover 给定，不跟随主题 */
export const IMMERSIVE_QUEUE_CLASSES: QueuePanelClasses = {
  panel: 'af-immersive-popover af-immersive-queue-panel',
  header: 'af-immersive-queue-header',
  list: 'af-immersive-queue-list',
  item: 'af-immersive-queue-item',
  playing: 'af-playing',
  play: 'af-immersive-queue-play',
  index: 'af-immersive-queue-index',
  info: 'af-immersive-queue-info',
  remove: 'af-immersive-queue-remove',
};

/** 迷你栏预设：颜色全部走主题变量，浅色与深色主题都不需要额外覆盖 */
export const BAR_QUEUE_CLASSES: QueuePanelClasses = {
  panel: 'af-bar-queue-panel',
  header: 'af-bar-queue-header',
  list: 'af-bar-queue-list',
  item: 'af-bar-queue-item',
  playing: 'af-playing',
  play: 'af-bar-queue-play',
  index: 'af-bar-queue-index',
  info: 'af-bar-queue-info',
  remove: 'af-bar-queue-remove',
  empty: 'af-bar-queue-empty',
};
