import React, { useEffect, useRef } from "react";

interface Orb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
}

/**
 * 3 soft monochrome platinum/white radial light orbs drifting at 30 FPS behind
 * the single-card setup surface. Stays completely static when
 * `prefers-reduced-motion: reduce` is enabled.
 */
export const SoftBackdrop: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = 640;
    const height = 420;
    canvas.width = width;
    canvas.height = height;

    const orbs: Orb[] = [
      { x: 140, y: 110, vx: 0.22, vy: 0.14, radius: 220, alpha: 0.09 },
      { x: 500, y: 310, vx: -0.18, vy: -0.15, radius: 240, alpha: 0.085 },
      { x: 340, y: 70, vx: -0.12, vy: 0.19, radius: 190, alpha: 0.075 },
    ];

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const orb of orbs) {
        const grad = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.radius);
        grad.addColorStop(0, `rgba(255, 255, 255, ${orb.alpha})`);
        grad.addColorStop(0.55, `rgba(228, 228, 231, ${orb.alpha * 0.35})`);
        grad.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    draw();
    if (reducedMotion) return;

    let rafId = 0;
    let lastTick = 0;
    const FRAME_MS = 1000 / 30;

    const step = (now: number) => {
      rafId = window.requestAnimationFrame(step);
      if (now - lastTick < FRAME_MS) return;
      lastTick = now;

      for (const orb of orbs) {
        orb.x += orb.vx;
        orb.y += orb.vy;
        if (orb.x < 40 || orb.x > width - 40) orb.vx *= -1;
        if (orb.y < 30 || orb.y > height - 30) orb.vy *= -1;
      }
      draw();
    };

    rafId = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  return <canvas ref={canvasRef} className="setup-soft-backdrop" aria-hidden="true" />;
};
