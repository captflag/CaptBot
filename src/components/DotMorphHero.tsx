import { useEffect, useRef } from 'react';
import { cn } from '../lib/utils';

type Point = [number, number, number];
type Shape = 'lattice' | 'sphere' | 'stack';
type Scene = { text: string } | { shape: Shape };

interface Target {
  tx: number;
  ty: number;
  tz: number;
  ta: number;
}

interface Dot extends Target {
  x: number;
  y: number;
  z: number;
  a: number;
  /** Easing speed; varies per dot so shapes dissolve rather than slide. */
  k: number;
  /** When the pending target takes effect, giving each morph a left-to-right sweep. */
  at: number;
  pend: Target | null;
  accent: boolean;
}

const SCENES: Scene[] = [
  { text: 'CAPTBOT' },
  { shape: 'lattice' },
  { text: 'ASK' },
  { shape: 'sphere' },
  { text: 'CITE' },
  { shape: 'stack' },
];
const HOLD_MS = 2800;
const MAX_DOTS = 2600;
const font = (size: number) => `700 ${size}px Inter, "Arial Black", system-ui, sans-serif`;

/** Samples the pixels of a word rendered off-screen into dot positions centred on the origin. */
function textPoints(word: string, W: number, H: number, step: number): Point[] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(W));
  c.height = Math.max(1, Math.floor(H));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  let size = H * 0.58;
  ctx.font = font(size);
  const width = ctx.measureText(word).width;
  if (width > W * 0.9) {
    size *= (W * 0.9) / width;
    ctx.font = font(size);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(word, c.width / 2, c.height / 2);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const out: Point[] = [];
  for (let y = step >> 1; y < c.height; y += step) {
    for (let x = step >> 1; x < c.width; x += step) {
      if (data[(y * c.width + x) * 4 + 3] > 120) out.push([x - c.width / 2, y - c.height / 2, (Math.random() - 0.5) * step]);
    }
  }
  return out;
}

function shapePoints(kind: Shape, W: number, H: number): Point[] {
  const R = Math.min(W, H) * 0.4;
  const out: Point[] = [];
  if (kind === 'sphere') {
    const n = 520;
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = i * 2.39996; // golden angle
      out.push([Math.cos(th) * r * R, y * R, Math.sin(th) * r * R]);
    }
  } else if (kind === 'lattice') {
    // 7×7×7, echoing the 7×7 grid of the DotFlow loader.
    const s = (R * 1.5) / 6;
    for (let a = 0; a < 7; a++) for (let b = 0; b < 7; b++) for (let c = 0; c < 7; c++) out.push([(a - 3) * s, (b - 3) * s, (c - 3) * s]);
  } else {
    // Four "pages": outlined, checker-filled slabs.
    const n = 11;
    for (let k = 0; k < 4; k++) {
      const y = (k - 1.5) * R * 0.34;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1;
          if (edge || (i + j) % 2 === 0) out.push([(i / (n - 1) - 0.5) * R * 1.6, y, (j / (n - 1) - 0.5) * R * 1.1]);
        }
      }
    }
  }
  return out;
}

function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** A pool of dots that fades and morphs between words and slowly turning 3D shapes. */
class DotMorph {
  private readonly ctx: CanvasRenderingContext2D;
  private dots: Dot[] = [];
  private targets: Point[][] = [];
  private W = 0;
  private H = 0;
  private step = 5;
  private idx = 0;
  private sceneAt = 0;
  private spin = false;
  private rotY = 0;
  private tiltX = 0;
  private mx = -1e4;
  private my = -1e4;
  private last = 0;
  private raf = 0;
  private running = false;
  private ink = '#111827';
  private accent = '#7c3aed';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly reduce: boolean,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  setColors(ink: string, accent: string) {
    this.ink = ink;
    this.accent = accent;
    this.render(performance.now());
  }

  /** Re-samples every scene for the current size. Safe to call before layout (no-ops at 0×0). */
  resize() {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    if (!W || !H) return;
    this.W = W;
    this.H = H;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.step = Math.max(3, Math.min(6, Math.round(Math.min(W, H * 2.5) / 140)));
    this.targets = SCENES.map((s) => ('text' in s ? textPoints(s.text, W, H, this.step) : shapePoints(s.shape, W, H)));
    const need = Math.min(MAX_DOTS, Math.max(...this.targets.map((t) => t.length)));
    while (this.dots.length < need) {
      this.dots.push({
        x: (Math.random() - 0.5) * W,
        y: (Math.random() - 0.5) * H,
        z: 0,
        tx: 0,
        ty: 0,
        tz: 0,
        a: 0,
        ta: 0,
        k: 0.05 + Math.random() * 0.07,
        at: 0,
        pend: null,
        accent: Math.random() < 0.07,
      });
    }
    // Snap so a still frame is visible immediately, even before the first animation frame.
    this.go(this.idx, true);
    this.render(performance.now());
  }

  next() {
    this.go(this.idx + 1, this.reduce || !this.running);
    this.render(performance.now());
  }

  pointer(x: number, y: number) {
    this.mx = x;
    this.my = y;
  }

  start() {
    if (this.running || this.reduce) return;
    this.running = true;
    this.last = performance.now();
    this.sceneAt = this.last;
    const loop = (now: number) => {
      if (!this.running) return;
      try {
        this.render(now);
      } catch (err) {
        // Keep one bad frame from killing the animation for good.
        console.error('DotMorph frame failed', err);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private go(i: number, snap: boolean) {
    if (!this.targets.length) return;
    this.idx = (i + SCENES.length) % SCENES.length;
    this.spin = 'shape' in SCENES[this.idx];
    const list = shuffle(this.targets[this.idx].slice());
    const now = performance.now();
    for (const d of this.dots) {
      const t = list.pop();
      const next: Target = t
        ? { tx: t[0], ty: t[1], tz: t[2], ta: 1 }
        : { tx: d.x * 1.5 + (Math.random() - 0.5) * 80, ty: d.y * 1.5 + (Math.random() - 0.5) * 80, tz: d.z, ta: 0 };
      if (snap) {
        Object.assign(d, next, { x: next.tx, y: next.ty, z: next.tz, a: next.ta, pend: null });
      } else {
        d.pend = next;
        d.at = now + (t ? (t[0] / this.W + 0.5) * 420 : 0) + Math.random() * 160;
      }
    }
    this.sceneAt = now;
  }

  private render(now: number) {
    const { ctx, W, H } = this;
    if (!W || !H) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.spin && !this.reduce) {
      this.rotY += dt * 0.45;
    } else {
      // Words face the viewer: ease back to the nearest front-on angle.
      this.rotY = Math.atan2(Math.sin(this.rotY), Math.cos(this.rotY)) * 0.92;
    }
    const aim = (this.spin ? 0.35 : 0) + (this.my > -1e3 ? (this.my / H - 0.5) * 0.3 : 0);
    this.tiltX += (aim - this.tiltX) * 0.06;
    if (this.running && now - this.sceneAt > HOLD_MS) this.go(this.idx + 1, false);

    ctx.clearRect(0, 0, W, H);
    const cy = Math.cos(this.rotY);
    const sy = Math.sin(this.rotY);
    const cx = Math.cos(this.tiltX);
    const sx = Math.sin(this.tiltX);
    const f = Math.max(W, H) * 1.3;
    const base = this.step * 0.62;
    for (const accentPass of [false, true]) {
      ctx.fillStyle = accentPass ? this.accent : this.ink;
      for (const d of this.dots) {
        if (d.accent !== accentPass) continue;
        if (d.pend && now >= d.at) {
          Object.assign(d, d.pend);
          d.pend = null;
        }
        d.x += (d.tx - d.x) * d.k;
        d.y += (d.ty - d.y) * d.k;
        d.z += (d.tz - d.z) * d.k;
        d.a += (d.ta - d.a) * 0.07;
        if (d.a < 0.02) continue;
        const x1 = d.x * cy + d.z * sy;
        const z1 = -d.x * sy + d.z * cy;
        const y2 = d.y * cx - z1 * sx;
        const z2 = d.y * sx + z1 * cx;
        const s = f / (f + z2);
        const X = W / 2 + x1 * s;
        const Y = H / 2 + y2 * s;
        if (this.mx > -1e3) {
          // Scatter dots under the cursor; easing pulls them back.
          const dx = X - this.mx;
          const dy = Y - this.my;
          const d2 = dx * dx + dy * dy;
          if (d2 < 3600) {
            const dist = Math.sqrt(d2) || 1;
            const push = (60 - dist) * 0.35;
            d.x += (dx / dist) * push;
            d.y += (dy / dist) * push;
          }
        }
        ctx.globalAlpha = Math.min(1, d.a) * Math.max(0.25, Math.min(1, s * s));
        const r = base * s;
        ctx.fillRect(X - r / 2, Y - r / 2, r, r);
      }
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Home-screen hero: dots that fade between words and turning shapes.
 * Decorative (the heading below carries the text), so it is hidden from assistive tech.
 */
export function DotMorphHero({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let engine: DotMorph;
    try {
      engine = new DotMorph(canvas, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return;
    }
    let alive = true;
    const readColors = () => {
      const style = getComputedStyle(canvas);
      engine.setColors(style.color, style.getPropertyValue('--dot-accent').trim() || '#7c3aed');
    };
    readColors();
    engine.resize();

    const resizeObserver = new ResizeObserver(() => engine.resize());
    resizeObserver.observe(canvas);
    // The dark/light toggle flips a class on <html>.
    const themeObserver = new MutationObserver(readColors);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const visibility = new IntersectionObserver(([entry]) => (entry.isIntersecting && !document.hidden ? engine.start() : engine.stop()));
    visibility.observe(canvas);
    const onVisibility = () => (document.hidden ? engine.stop() : engine.start());
    document.addEventListener('visibilitychange', onVisibility);
    // Re-sample the words once the web font is in. Drawing to a canvas doesn't trigger the download, so ask for it.
    const fonts = document.fonts;
    if (fonts) {
      void Promise.all([fonts.ready, fonts.load(font(48))]).then(
        () => alive && engine.resize(),
        () => undefined,
      );
    }

    const move = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      engine.pointer(e.clientX - box.left, e.clientY - box.top);
    };
    const leave = () => engine.pointer(-1e4, -1e4);
    const click = () => engine.next();
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('click', click);

    return () => {
      alive = false;
      engine.stop();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      visibility.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('click', click);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={cn(
        'block h-[clamp(170px,30vw,260px)] w-full cursor-crosshair touch-none text-gray-900 [--dot-accent:#7c3aed] dark:text-white dark:[--dot-accent:#a78bfa]',
        className,
      )}
    />
  );
}
