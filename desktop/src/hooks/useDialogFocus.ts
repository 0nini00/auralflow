import { useEffect, useRef, type RefObject } from 'react';

interface DialogFocusOptions {
  open: boolean;
  containerRef: RefObject<HTMLElement>;
  onClose?: () => void;
  closeOnEscape?: boolean;
}

interface DialogEntry {
  container: HTMLElement;
  previousFocus: HTMLElement | null;
  lastFocus: HTMLElement | null;
  options: RefObject<Pick<DialogFocusOptions, 'onClose' | 'closeOnEscape'>>;
}

// 每个文档只有一个栈和一组监听器；不使用 inert，避免同一 React 根下的兄弟弹窗互相遮蔽。
const dialogStacks = new WeakMap<Document, { entries: DialogEntry[]; dispose: () => void }>();
const FOCUSABLE = 'a[href], area[href], button, input, select, textarea, summary, [tabindex], [contenteditable]:not([contenteditable="false"])';
const PORTAL_MENU = '[role="menu"], [role="listbox"]';

function isAvailable(element: HTMLElement): boolean {
  if (!element.isConnected || element.matches(':disabled') || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView!.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function ownedRoots(entry: DialogEntry): HTMLElement[] {
  const roots = [entry.container];
  for (const root of roots) {
    for (const control of root.querySelectorAll('[aria-controls], [aria-owns]')) {
      const ids = `${control.getAttribute('aria-controls') ?? ''} ${control.getAttribute('aria-owns') ?? ''}`.trim().split(/\s+/);
      for (const id of ids) {
        const portal = root.ownerDocument.getElementById(id);
        if (portal && !roots.includes(portal) && !roots.some((item) => item.contains(portal))) roots.push(portal);
      }
    }
  }
  return roots;
}

function contains(entry: DialogEntry, target: Node): boolean {
  return ownedRoots(entry).some((root) => root.contains(target));
}

function tabbables(entry: DialogEntry): HTMLElement[] {
  return ownedRoots(entry).flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)))
    .filter((element) => element.tabIndex >= 0 && isAvailable(element))
    .sort((left, right) => (left.tabIndex || Infinity) - (right.tabIndex || Infinity));
}

function initialFocus(entry: DialogEntry): HTMLElement {
  const preferred = entry.container.querySelector<HTMLElement>('[data-dialog-initial-focus], [autofocus]');
  return preferred && isAvailable(preferred) ? preferred : tabbables(entry)[0] ?? entry.container;
}

function focusInside(entry: DialogEntry) {
  const target = entry.lastFocus && isAvailable(entry.lastFocus) ? entry.lastFocus : initialFocus(entry);
  target.focus();
}

function listen(document: Document, stack: DialogEntry[]) {
  function onFocus(event: FocusEvent) {
    const entry = stack[stack.length - 1];
    const target = event.target as HTMLElement;
    if (!entry) return;
    if (contains(entry, target)) { entry.lastFocus = target; return; }
    focusInside(entry);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const entry = stack[stack.length - 1];
    if (!entry) return;
    const target = event.target as HTMLElement;
    if (event.key === 'Escape') {
      if (target.closest(PORTAL_MENU) && contains(entry, target)) return;
      if (entry.options.current?.closeOnEscape === false || !entry.options.current?.onClose) return;
      event.preventDefault();
      event.stopPropagation();
      entry.options.current.onClose();
      return;
    }
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = tabbables(entry);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = index < 0 ? (event.shiftKey ? items.length - 1 : 0)
      : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
    // 显式连接 portal 与容器的 Tab 序列，避免原生 DOM 顺序先经过背景控件。
    event.preventDefault();
    (items[next] ?? entry.container).focus();
  }

  document.addEventListener('focusin', onFocus);
  document.addEventListener('keydown', onKeyDown);
  return () => {
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('keydown', onKeyDown);
  };
}

/** 容器需提供 role/name；可用 data-dialog-initial-focus 指定初始焦点，portal 用 aria-controls/owns 关联。 */
export function useDialogFocus({ open, containerRef, onClose, closeOnEscape = true }: DialogFocusOptions) {
  const options = useRef({ onClose, closeOnEscape });
  options.current = { onClose, closeOnEscape };

  useEffect(() => {
    const container = containerRef.current;
    if (!open || !container) return;
    const document = container.ownerDocument;
    let state = dialogStacks.get(document);
    if (!state) {
      const entries: DialogEntry[] = [];
      state = { entries, dispose: listen(document, entries) };
      dialogStacks.set(document, state);
    }
    const stack = state.entries;
    const previousTabIndex = container.getAttribute('tabindex');
    if (previousTabIndex === null) container.tabIndex = -1;
    const entry: DialogEntry = { container, previousFocus: document.activeElement as HTMLElement | null, lastFocus: null, options };
    const childIndex = stack.findIndex((item) => container.contains(item.container));
    if (childIndex < 0) {
      stack.push(entry);
      // 不覆盖调用方已放在弹窗内的焦点。
      if (document.activeElement && container.contains(document.activeElement)) entry.lastFocus = document.activeElement as HTMLElement;
      else focusInside(entry);
    } else {
      // React 子组件 effect 先运行，DOM 嵌套关系优先于 effect 注册顺序。
      entry.previousFocus = stack[childIndex].previousFocus;
      stack[childIndex].previousFocus = initialFocus(entry);
      stack.splice(childIndex, 0, entry);
    }

    return () => {
      const index = stack.indexOf(entry);
      const wasTop = index === stack.length - 1;
      stack.splice(index, 1);
      // 父层先卸载时，将恢复链交给仍存在的子层。
      for (const item of stack) {
        if (item.previousFocus && container.contains(item.previousFocus)) item.previousFocus = entry.previousFocus;
      }
      if (previousTabIndex === null) container.removeAttribute('tabindex');
      if (!stack.length) {
        state.dispose();
        dialogStacks.delete(document);
      }
      if (!wasTop) return;
      const next = stack[stack.length - 1];
      if (entry.previousFocus && isAvailable(entry.previousFocus) && (!next || contains(next, entry.previousFocus))) entry.previousFocus.focus();
      else if (next) focusInside(next);
    };
  }, [open, containerRef]);
}
