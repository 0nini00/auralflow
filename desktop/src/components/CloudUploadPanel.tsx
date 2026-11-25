import {
  isCloudUploadTaskTerminal,
  useCloudUploadStore,
  type CloudUploadTask,
} from '@/stores/cloudUploadStore';

function phaseLabel(task: CloudUploadTask): string {
  switch (task.phase) {
    case 'queued':
      return '等待上传';
    case 'hashing':
      return '计算校验值';
    case 'checking':
      return '准备上传';
    case 'uploading': {
      const percent = task.total > 0
        ? Math.min(100, Math.round((task.uploaded / task.total) * 100))
        : 0;
      return `上传中 ${percent}%`;
    }
    case 'completing':
      return '写入云盘';
    case 'cancelling':
      return '正在取消';
    case 'done':
      return '已完成';
    case 'failed':
      return task.error || '上传失败';
    case 'cancelled':
      return '已取消';
  }
}

/** 云盘页顶部的上传进度卡；无任务时不占空间。 */
export function CloudUploadPanel() {
  const tasks = useCloudUploadStore((state) => state.tasks);
  const running = useCloudUploadStore((state) => state.running);
  const cancel = useCloudUploadStore((state) => state.cancel);
  const clear = useCloudUploadStore((state) => state.clear);

  if (tasks.length === 0) return null;

  const doneCount = tasks.filter((task) => task.phase === 'done').length;
  const failedTasks = tasks.filter((task) => task.phase === 'failed');
  const cancelledCount = tasks.filter((task) => task.phase === 'cancelled').length;
  const activeTask = tasks.find((task) => !isCloudUploadTaskTerminal(task.phase));
  const activeIndex = activeTask ? tasks.indexOf(activeTask) : -1;
  const firstFailedTask = failedTasks[0];
  const percent = activeTask && activeTask.total > 0
    ? Math.min(100, Math.round((activeTask.uploaded / activeTask.total) * 100))
    : doneCount === tasks.length
      ? 100
      : 0;
  const title = running
    ? `正在上传 ${activeIndex >= 0 ? activeIndex + 1 : doneCount}/${tasks.length}`
    : failedTasks.length > 0
      ? `上传结束：${doneCount} 首成功，${failedTasks.length} 首失败`
      : cancelledCount > 0
        ? doneCount > 0
          ? `已上传 ${doneCount} 首，${cancelledCount} 首取消`
          : `已取消 ${cancelledCount} 首`
        : `已上传 ${doneCount} 首`;
  const detail = activeTask
    ? phaseLabel(activeTask)
    : firstFailedTask
      ? phaseLabel(firstFailedTask)
      : cancelledCount > 0
        ? '已取消'
        : '上传完成';

  return (
    <div className="af-cloud-upload-panel" role="status" aria-live="polite">
      <div className="af-cloud-upload-head">
        <strong>{title}</strong>
        <button
          type="button"
          className="af-cloud-upload-action"
          onClick={running ? cancel : clear}
        >
          {running ? '取消' : '关闭'}
        </button>
      </div>
      <div className="af-cloud-upload-file">
        {activeTask ? activeTask.fileName : tasks[tasks.length - 1]?.fileName}
      </div>
      <div className={`af-cloud-upload-phase${firstFailedTask && !running ? ' af-cloud-upload-error' : ''}`}>
        {detail}
      </div>
      <div className="af-cloud-upload-track" aria-hidden="true">
        <div className="af-cloud-upload-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
