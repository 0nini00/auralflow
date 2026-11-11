import { useEffect, useRef } from "react";

interface Props {
  mode: "off" | "trail";
}

interface Particle {
  x: number;
  y: number;
  r: number;
  life: number;
}

/**
 * 轻量鼠标拖尾特效：跟随鼠标的衰减圆点。
 * 仅在 mode !== "off" 时激活，单 canvas 全屏覆盖、pointer-events:none。
 */
export function CursorEffect({ mode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const particlesRef = useRef<Particle[]>([]);

  useEffect(() => {
    if (mode === "off") return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--af-accent-primary")
      .trim() || "#3b82f6";

    const onMove = (e: MouseEvent) => {
      const arr = particlesRef.current;
      arr.push({ x: e.clientX, y: e.clientY, r: 6, life: 1 });
      if (arr.length > 40) arr.splice(0, arr.length - 40);
      // 循环在粒子清空时会自己停下，新粒子到了再唤醒。
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
    };
    window.addEventListener("mousemove", onMove);

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const arr = particlesRef.current;
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        p.life -= 0.04;
        p.r *= 0.96;
        if (p.life <= 0) {
          arr.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.globalAlpha = p.life * 0.5;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // 没有粒子就停帧：原来无条件自续，鼠标静止时也在 60fps 清整块全屏 canvas。
      if (arr.length === 0) {
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      particlesRef.current = [];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [mode]);

  if (mode === "off") return null;

  return (
    <canvas
      ref={canvasRef}
      className="af-cursor-effect"
      aria-hidden="true"
    />
  );
}
