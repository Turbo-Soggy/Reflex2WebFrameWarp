/* ============================================================================
   Frame Warp — report demo site.
   Visual identity: DESIGN (1).md "blueprint on midnight glass" (sacred).
   Motion: Framer Motion — scroll-linked parallax, masked entrances,
   layout morphs, magnetic hover. All gated behind prefers-reduced-motion.
   ========================================================================== */
import { useRef, useState } from 'react';
import {
  motion,
  AnimatePresence,
  useScroll,
  useSpring,
  useTransform,
  useMotionValue,
  useReducedMotion,
  useInView,
} from 'framer-motion';

/* The one easing curve used for every entrance ("ease-out-expo" family). */
const EASE = [0.16, 1, 0.3, 1];
const LAYOUT_SPRING = { type: 'spring', stiffness: 220, damping: 28 };

/* ============================================================================
   Motion primitives
   ========================================================================== */

/** Magnetic — children subtly pull toward the cursor while it is over them.
    Spring-backed so the pull has momentum and release snaps home fluidly. */
function Magnetic({ children, strength = 0.25, className = '' }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 320, damping: 20, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 320, damping: 20, mass: 0.5 });

  const onMove = (e) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const onLeave = () => { x.set(0); y.set(0); };

  return (
    <motion.div ref={ref} onPointerMove={onMove} onPointerLeave={onLeave}
      style={{ x: sx, y: sy }} className={`inline-block ${className}`}>
      {children}
    </motion.div>
  );
}

/** MaskReveal — text slides up out of an invisible overflow mask.
    The OUTER mask is what's observed for viewport entry: the inner element
    starts fully clipped by overflow:hidden, so IntersectionObserver would
    never see it "enter view" (whileInView on the inner div deadlocks). */
function MaskReveal({ children, delay = 0, className = '', as: Tag = 'div' }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <Tag ref={ref} className={`overflow-hidden ${className}`}>
      <motion.div
        initial={reduce ? { opacity: 0 } : { y: '110%' }}
        animate={inView ? (reduce ? { opacity: 1 } : { y: '0%' }) : undefined}
        transition={{ duration: 0.9, ease: EASE, delay }}
      >
        {children}
      </motion.div>
    </Tag>
  );
}

/** Reveal — rise-and-fade entrance triggered by viewport intersection. */
function Reveal({ children, delay = 0, y = 28, className = '' }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.8, ease: EASE, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Stagger — parent/child variant pair for dynamic list reveals. */
const staggerParent = (delayChildren = 0, stagger = 0.1) => ({
  hidden: {},
  show: { transition: { delayChildren, staggerChildren: stagger } },
});
const staggerChild = (reduce) => ({
  hidden: { opacity: 0, y: reduce ? 0 : 24, scale: reduce ? 1 : 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.8, ease: EASE } },
});

/* ============================================================================
   Backdrop — scroll-linked parallax grid + breathing Blueprint Glow.
   The grid recedes slower than content; the glow recedes faster and dims,
   so the page reads as three depth planes while scrolling.
   ========================================================================== */
function Backdrop() {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const gridY = useSpring(useTransform(scrollY, (v) => v * -0.06),
    { stiffness: 120, damping: 28, mass: 0.6 });
  const glowY = useSpring(useTransform(scrollY, (v) => v * -0.22),
    { stiffness: 90, damping: 30, mass: 0.8 });
  const glowScale = useTransform(scrollY, [0, 1400], [1, 1.3]);
  const glowOpacity = useTransform(scrollY, [0, 1000], [1, 0.35]);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden>
      <motion.div
        className="grid-pattern mask-fade-b absolute inset-x-0 top-0 h-[160%]"
        style={reduce ? {} : { y: gridY }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ duration: 1.6, ease: 'easeOut' }}
      />
      <motion.div
        className="glow-radial absolute left-1/2 top-[-180px] h-[480px] w-[900px] ml-[-450px]"
        style={reduce ? {} : { y: glowY, scale: glowScale, opacity: glowOpacity }}
        initial={{ opacity: 0 }}
        animate={reduce ? { opacity: 1 } : undefined}
        transition={{ duration: 1.6, ease: 'easeOut' }}
      />
    </div>
  );
}

/** Hairline scroll-progress indicator in Frost Link — quiet, instrument-like. */
function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });
  return (
    <motion.div
      className="fixed inset-x-0 top-0 z-50 h-px origin-left bg-frost-link/60"
      style={{ scaleX }}
      aria-hidden
    />
  );
}

/* ============================================================================
   Content data
   ========================================================================== */
const STATS = [
  { value: '91 ms', accent: '→ 17 ms', label: 'View-direction staleness, local demo (30 FPS source, 80 ms pipeline delay, 60 Hz display)' },
  { value: 'Flat at', accent: '~17 ms', label: 'Warped view latency over WebRTC at 40 / 100 / 160 ms one-way network delay — and independent of jitter' },
  { value: '+73%', accent: '→ +9%', label: 'Guard-band rendering overhead on calm input with the velocity-adaptive margin policy' },
];

const CLOCKS = [
  {
    title: 'The fast clock', tag: 'input.js',
    body: 'Pointer-lock mouse input sampled on every event (125–1000 Hz) maintains the camera yaw and pitch — the freshest pose the system has.',
    icon: <svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" /><path d="M10 5.5 V10 L13 12" /></svg>,
  },
  {
    title: 'The slow clock', tag: 'lag.js',
    body: 'The 3D scene renders at a capped 30 FPS into an off-screen texture, deliberately using an orientation from a configurable interval in the past — the always-on simulated condition of a heavy pipeline.',
    icon: <svg width="20" height="20" viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="10" rx="1.5" /><path d="M7 17h6" /></svg>,
  },
  {
    title: 'The compositor', tag: 'warp-shader.js',
    body: 'Every display refresh, a fullscreen-quad shader draws the newest texture shifted by the angular delta between freshest input and the frame’s pose: Δu = −Δyaw/fovₓ, Δv = Δpitch/fovᵧ.',
    icon: <svg width="20" height="20" viewBox="0 0 20 20"><path d="M4 14 L8 8 L12 11 L16 5" /><path d="M4 17 h12" /></svg>,
  },
];

const ARTEFACTS = [
  {
    id: 'range', title: '1 · The shooting range', tag: 'Local · src/',
    body: 'A browser demo (Three.js/WebGL) where a 30 FPS, deliberately delayed pipeline is reprojected to display rate. Press W and watch tracked shots start to land.',
    detail: 'Hit detection is honest by construction: a click fires one ray, from the camera orientation the screen is currently displaying — the current orientation when warp is on, the lagged orientation when off — against identical targets whose positions advance only on the render tick. The outcome can differ between modes only through the view-direction latency the warp removes, which is exactly the quantity under test. Live measured latency and CSV export are built in.',
    icon: <svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3" /><circle cx="10" cy="10" r="0.5" /></svg>,
  },
  {
    id: 'cloud', title: '2 · The cloud pipeline', tag: 'Streamed · src/cloud/',
    body: 'A server window streams the rendered scene as WebRTC video; the player window reprojects the decoded stream using local input, under configurable delay and jitter.',
    detail: 'Pose synchronisation is frame-exact: the server bakes a 16-bit frame identifier into a 4×4 grid of black/white cells in the frame’s corner — inside the guard-band margin, so the displayed crop hides it — and the client reads the identifier back from the decoded pixels and looks up the pose that travelled on the data channel. End-to-end latency is measured entirely in the client’s clock: the client timestamps each forwarded input packet, the server echoes which input sequence each frame used, and the displayed frame’s tag closes the loop.',
    icon: <svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 13 a5 5 0 0 1 2-9.5 a5.5 5.5 0 0 1 10.5 1.5 a4 4 0 0 1 1.5 8" /><path d="M10 9 v7 M7.5 13.5 L10 16 L12.5 13.5" /></svg>,
  },
  {
    id: 'replay', title: '3 · The replay instrument', tag: 'Deterministic · src/replay/',
    body: 'Recorded or synthetic input traces re-run through the full pipeline logic headlessly and bit-reproducibly. Same input, different pipeline — perfectly controlled comparisons.',
    detail: 'The headless simulator drives the actual LagSim class through the same display-tick/render-tick structure as the live loop, models the warp delta and its guard-band clamp, and emits per-tick CSV. It is bit-reproducible across runs and processes, which is what turns the analytic claims into automated tests: the clamp-onset bound, the linearisation zero-crossing and the adaptive-guard policy are all checked by the 39-test suite. Every figure on this page is generated from this instrument or from the live demos’ CSV exports.',
    icon: <svg width="20" height="20" viewBox="0 0 20 20"><path d="M4 4 h12 v12 h-12 z" /><path d="M7 13 v-3 M10 13 v-6 M13 13 v-4" /></svg>,
  },
];

const BOUNDS = [
  {
    title: 'Jitter immunity', tag: '§4.2',
    body: 'If the required delta is within the guard margin, the displayed view direction equals the input pose sampled at composite time exactly. The frame’s age determines only which pose enters the subtraction — the subtraction then cancels it. Perceived rotation latency is independent of both the mean and the variance of frame age.',
  },
  {
    title: 'Guard-band exhaustion', tag: '§4.3 · Figure 2',
    body: 'The largest compensable rotation is Δmax = 16.98° at the default configuration. Clamping is predicted to begin between 130.6 and 212.2 deg/s; the simulator measures onset at ≈143 deg/s — inside the band. The display-tick term in the age bound was found by a failing automated test.',
  },
  {
    title: 'Linearisation & parallax', tag: '§4.4–4.5',
    body: 'The shader’s shift is linear in angle while a perspective image is linear in its tangent: brisk tracking at 60 deg/s with a 100 ms-old frame misplaces centre pixels by ≈22 px, converging to zero as rotation stops. Translation parallax is uncompensated and bounded analytically — the motivation for depth-aware reprojection.',
  },
];

const FIGURES = [
  {
    src: 'figures/fig1-lag-sweep.png', n: 1,
    caption: 'View-direction latency vs injected pipeline delay (replay instrument, wander trace, 60 Hz display). The without-warp series rises with delay; the warped view direction stays at one display interval.',
  },
  {
    src: 'figures/fig2-onset.png', n: 2,
    caption: 'Guard-band exhaustion under constant angular velocity: measured clamp rate and residual error, with the analytic onset bounds shaded. Clamping begins at ≈143 deg/s, inside the predicted band — the project’s theory-meets-instrument result.',
  },
  {
    src: 'figures/fig3-adaptive.png', n: 3,
    caption: 'Rendered-pixel cost of the guard band, fixed vs velocity-adaptive, with clamp rates annotated (replay benchmark, three wander traces).',
  },
];

const REFS = [
  'J. Carmack, “Latency Mitigation Strategies,” AltDevBlogADay, 2013.',
  'J. M. P. van Waveren, “The Asynchronous Time Warp for Virtual Reality on Consumer Hardware,” Proc. ACM VRST, 2016.',
  'W. R. Mark, L. McMillan, and G. Bishop, “Post-Rendering 3D Warping,” Proc. I3D, 1997.',
  'K.-T. Chen et al., “Measuring the Latency of Cloud Gaming Systems,” Proc. ACM Multimedia, 2011.',
  'M. Claypool and K. Claypool, “Latency and Player Actions in Online Games,” CACM, 2006.',
  'T. Kamarainen et al., “A Measurement Study on Achieving Imperceptible Latency in Mobile Cloud Gaming,” Proc. ACM MMSys, 2017.',
  'K. Lee et al., “Outatime: Using Speculation to Enable Low-Latency Continuous Interaction for Mobile Cloud Gaming,” Proc. ACM MobiSys, 2015.',
  'NVIDIA, “Reflex 2 with Frame Warp,” announced CES 2025.',
  'M. Siekkinen and T. Kamarainen, “Streaming Real-Time Rendered Scenes as 3D Gaussians,” arXiv:2604.02851, 2026.',
];

/* ============================================================================
   Sections
   ========================================================================== */

function Nav() {
  return (
    <nav className="sticky top-0 z-40 border-b border-steel-border/40 bg-midnight-ink/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4">
        <a href="#" className="font-mono text-[15px] tracking-[0.1em] text-white">FRAME WARP</a>
        <div className="flex items-center gap-1 text-body-sm">
          {[['#design', 'Design'], ['#analysis', 'Analysis'], ['#results', 'Results'], ['#limits', 'Limits']].map(([href, label]) => (
            <a key={href} href={href}
              className="rounded-full px-3.5 py-2 text-moonlight transition-colors duration-200 hover:bg-moonlight/8 hover:text-glacier">
              {label}
            </a>
          ))}
          <Magnetic strength={0.2}>
            <a href="FrameWarp_Project_Report.pdf" className="btn-ghost !py-2 !px-3.5 text-body-sm">Report PDF</a>
          </Magnetic>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  const reduce = useReducedMotion();
  return (
    <header className="relative mx-auto mt-10 max-w-[1200px] px-6 pb-14 pt-24 text-center">
      <motion.div className="conic-hairline absolute inset-x-6 top-0 h-px"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.6 }} aria-hidden />

      <MaskReveal><span className="eyebrow">B.Tech Final-Year Project · June 2026</span></MaskReveal>
      <MaskReveal delay={0.08} className="mt-6">
        <h1 className="font-display text-display font-medium text-white">Frame Warp</h1>
      </MaskReveal>
      <MaskReveal delay={0.16} className="mx-auto mt-4 max-w-[620px]">
        <p className="text-subheading text-pebble">
          Client-side frame reprojection for motion-to-photon latency mitigation in browser
          and cloud-streamed rendering. The latency the network adds does not have to be the
          latency the player feels.
        </p>
      </MaskReveal>

      <Reveal delay={0.26} y={16} className="mt-9 flex flex-wrap justify-center gap-3">
        <Magnetic strength={0.3}>
          <motion.a whileTap={reduce ? undefined : { scale: 0.98 }} className="btn-primary"
            href="FrameWarp_Project_Report.pdf">Read the full report</motion.a>
        </Magnetic>
        <Magnetic strength={0.3}>
          <motion.a whileTap={reduce ? undefined : { scale: 0.98 }} className="btn-ghost"
            href="#results">See the measurements</motion.a>
        </Magnetic>
      </Reveal>
    </header>
  );
}

function StatChips() {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="mx-auto mt-16 grid max-w-[880px] grid-cols-1 gap-4 px-6 md:grid-cols-3"
      variants={staggerParent(0.45, 0.1)} initial="hidden" animate="show"
    >
      {STATS.map((s) => (
        <motion.div key={s.label} variants={staggerChild(reduce)} className="plate-card text-center">
          <div className="font-display text-heading font-medium text-glacier">
            {s.value} <span className="text-frost-link">{s.accent}</span>
          </div>
          <p className="mt-2 text-caption text-fog">{s.label}</p>
        </motion.div>
      ))}
    </motion.div>
  );
}

function SectionHead({ eyebrow, title, lede }) {
  return (
    <div className="mx-auto max-w-[760px] text-center">
      <MaskReveal><span className="eyebrow">{eyebrow}</span></MaskReveal>
      <MaskReveal delay={0.08} className="mt-4">
        <h2 className="font-display text-[44px] font-medium leading-[1.16] text-glacier">{title}</h2>
      </MaskReveal>
      {lede && (
        <Reveal delay={0.18} y={20} className="mx-auto mt-4 max-w-[680px]">
          <p className="text-pebble">{lede}</p>
        </Reveal>
      )}
    </div>
  );
}

function Problem() {
  return (
    <section id="problem" className="mx-auto mt-[120px] max-w-[1200px] px-6">
      <SectionHead eyebrow="The problem" title="Your view lags your hand"
        lede="Motion-to-photon latency is the delay between physical input and the photons that reflect it — the dominant feel-defining property of interactive rendering." />
      <Reveal className="mx-auto mt-6 max-w-[760px] text-left">
        <p>
          A display refreshes at a fixed rate, but the underlying 3D scene may be redrawn far
          less often — a demanding game at 30 FPS produces a new frame only every 33 ms — and
          every stage of a real pipeline (input sampling, simulation, rendering, queueing, and
          in cloud streaming: encoding, transmission, decoding) holds the user’s input a little
          longer before it becomes visible.
        </p>
        <p className="mt-4 text-pebble">
          Prior measurement studies place cloud gaming latencies in the 100–300 ms range, with
          measurable degradation of player performance well below that. For camera control it
          is directly felt: the view lags the hand.
        </p>
      </Reveal>
      <Reveal delay={0.1} className="mx-auto mt-8 max-w-[760px]">
        <div className="plate-card text-center font-mono text-body-sm leading-7 text-frost-link">
          L<sub>total</sub> = L<sub>input</sub> + L<sub>uplink</sub> + L<sub>render</sub> + L<sub>encode</sub> + L<sub>downlink</sub> + L<sub>decode</sub> + L<sub>composite</sub>
          <p className="mt-2.5 font-sans text-caption text-fog">
            For camera rotation, client-side reprojection replaces every term except the last.
          </p>
        </div>
      </Reveal>
    </section>
  );
}

function TileGrid({ items, children }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="mx-auto mt-12 grid max-w-[1000px] grid-cols-1 gap-4 md:grid-cols-3"
      variants={staggerParent(0.1, 0.12)} initial="hidden" whileInView="show"
      viewport={{ once: true, margin: '-80px' }}
    >
      {items.map((t) => (
        <motion.div key={t.title} variants={staggerChild(reduce)}>
          <Magnetic strength={0.06} className="block h-full w-full">
            <div className="plate-card group h-full text-left transition-shadow duration-200 hover:shadow-ignite">
              {t.icon && (
                <div className="icon-tile mb-4 group-hover:shadow-ignite">{t.icon}</div>
              )}
              <h3 className="text-subheading font-semibold text-ice">{t.title}</h3>
              <p className="mt-2 text-body-sm text-pebble">{t.body}</p>
              {t.tag && <span className="mono-tag mt-3.5 inline-block">{t.tag}</span>}
            </div>
          </Magnetic>
        </motion.div>
      ))}
      {children}
    </motion.div>
  );
}

function Idea() {
  return (
    <section id="idea" className="mx-auto mt-[120px] max-w-[1200px] px-6">
      <SectionHead eyebrow="The idea" title="Two clocks, one warp"
        lede="Mouse input is available at hundreds of hertz even when frames are not. So run two clocks — and let the fast one steer the slow one’s pixels." />
      <Reveal className="mx-auto mt-6 max-w-[760px] text-left">
        <p>
          The scene is rendered into a texture at its slow native rate. At every display
          refresh, the latest texture is warped — shifted by the camera rotation that has
          occurred since the frame was rendered — so the displayed view direction tracks the
          freshest input even though the pixels are old. The technique descends from
          post-rendering 3D warping, reached consumers as VR asynchronous timewarp, and is the
          substance of NVIDIA’s announced Reflex 2 Frame Warp.
        </p>
      </Reveal>
      <TileGrid items={CLOCKS} />
    </section>
  );
}

/** Artefact cards — click one and it morphs to full width while its siblings
    slide out of the way with spring momentum (Framer Motion layout). */
function Artefacts() {
  const [open, setOpen] = useState(null);
  const reduce = useReducedMotion();
  return (
    <section id="design" className="mx-auto mt-[120px] max-w-[1200px] px-6">
      <SectionHead eyebrow="System design" title="Three artefacts, one compositor"
        lede="A local demo that makes the problem falsifiable, the same pipeline split across a real network, and a deterministic instrument that turns the claims into automated tests. Click a card to expand it." />
      <motion.div layout={!reduce} className="mx-auto mt-12 grid max-w-[1000px] grid-cols-1 gap-4 md:grid-cols-3">
        {ARTEFACTS.map((a) => {
          const isOpen = open === a.id;
          return (
            <motion.div
              key={a.id} layout={!reduce} transition={{ layout: LAYOUT_SPRING }}
              onClick={() => setOpen(isOpen ? null : a.id)}
              className={`plate-card cursor-pointer text-left transition-shadow duration-200 hover:shadow-ignite ${isOpen ? 'md:col-span-3' : ''}`}
            >
              <motion.div layout={!reduce ? 'position' : false} className="flex items-start gap-4">
                <div className="icon-tile shrink-0">{a.icon}</div>
                <div>
                  <h3 className="text-subheading font-semibold text-ice">{a.title}</h3>
                  <p className="mt-2 text-body-sm text-pebble">{a.body}</p>
                  <span className="mono-tag mt-3.5 inline-block">{a.tag}</span>
                </div>
              </motion.div>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.5, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <p className="mt-4 border-t border-steel-border/50 pt-4 text-body-sm text-moonlight">
                      {a.detail}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </motion.div>
      <Reveal className="mx-auto mt-6 max-w-[760px] text-left">
        <p className="text-pebble">
          A shifted image needs pixels beyond its own edge, so the scene renders at a wider
          field of view than displayed and the shader shows the central crop — the{' '}
          <strong className="font-semibold text-ice">guard band</strong> (margin g = 0.12 per
          side, with the tangent-exact relation tan(F<sub>render</sub>/2) =
          tan(F<sub>display</sub>/2)/(1−2g)). Edge clamping remains only as the fallback when
          motion exhausts the margin — the failure mode the analysis bounds.
        </p>
      </Reveal>
    </section>
  );
}

function Analysis() {
  return (
    <section id="analysis" className="mx-auto mt-[120px] max-w-[1200px] px-6">
      <SectionHead eyebrow="Theoretical analysis" title="Limits stated as precisely as gains"
        lede="The warp’s error model is written down, bounded, and then checked against the instrument — including one bound the instrument corrected." />
      <TileGrid items={BOUNDS} />
    </section>
  );
}

/** Figure card — the image flies out into a fullscreen lightbox via layoutId,
    morphing fluidly between its grid slot and the overlay. */
function Results({ onZoom }) {
  return (
    <section id="results" className="mx-auto mt-[120px] max-w-[1200px] px-6">
      <SectionHead eyebrow="Results" title="Measured, not asserted"
        lede="Every latency number is computed from real timestamps, exported as CSV, and — for the analytic claims — reproduced by automated tests. Click a figure to inspect it." />

      <Reveal className="mx-auto mt-10 max-w-[880px]">
        <figure className="plate-card">
          <motion.img
            layoutId={FIGURES[0].src} src={FIGURES[0].src} alt={FIGURES[0].caption}
            onClick={() => onZoom(FIGURES[0].src)}
            className="w-full cursor-zoom-in rounded-badges"
          />
          <figcaption className="mt-3.5 text-left text-caption text-fog">
            <strong className="font-medium text-pebble">Figure 1.</strong> {FIGURES[0].caption}
          </figcaption>
        </figure>
      </Reveal>

      <Reveal className="mx-auto mt-10 max-w-[760px]">
        <div className="plate-card overflow-x-auto">
          <table>
            <thead><tr><th>One-way delay</th><th>E2E latency, warp off</th><th>View latency, warp on</th></tr></thead>
            <tbody>
              {[['40 ms', '~150 ms'], ['100 ms', '~264 ms'], ['160 ms', '~381 ms']].map(([d, e]) => (
                <tr key={d}>
                  <td className="num">{d}</td>
                  <td className="num text-ember">{e}</td>
                  <td className="num font-medium text-frost-link">~17 ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3.5 text-center text-caption text-fog">
          Table 1. Measured cloud-pipeline latency on loopback (CSV export, per-mode means). The
          pixel frame tag resolved the displayed frame’s pose exactly throughout; timestamp
          matching agreed ~99.5% on a calm network, ~95% under jitter.
        </p>
      </Reveal>

      {FIGURES.slice(1).map((f) => (
        <Reveal key={f.src} className="mx-auto mt-10 max-w-[880px]">
          <figure className="plate-card">
            <motion.img
              layoutId={f.src} src={f.src} alt={f.caption} onClick={() => onZoom(f.src)}
              className="w-full cursor-zoom-in rounded-badges"
            />
            <figcaption className="mt-3.5 text-left text-caption text-fog">
              <strong className="font-medium text-pebble">Figure {f.n}.</strong> {f.caption}
            </figcaption>
          </figure>
        </Reveal>
      ))}

      <Reveal className="mx-auto mt-10 max-w-[760px]">
        <div className="plate-card overflow-x-auto">
          <table>
            <thead><tr><th>Trace</th><th>Policy</th><th>Pixel cost (×display)</th><th>Clamp rate</th></tr></thead>
            <tbody>
              {[
                ['calm', 'fixed 0.12', '1.73', '0%', ''],
                ['calm', 'adaptive', '1.33', '0%', 'good-cost'],
                ['moderate', 'fixed 0.12', '1.73', '0.7%', 'bad-clamp'],
                ['moderate', 'adaptive', '1.92', '0%', 'good-clamp'],
                ['hot', 'fixed 0.12', '1.73', '8.6%', 'bad-clamp'],
                ['hot', 'adaptive', '2.47', '0%', 'good-clamp'],
              ].map(([trace, policy, cost, clamp, mark], i) => (
                <tr key={i}>
                  <td>{trace}</td>
                  <td>{policy}</td>
                  <td className={`num ${mark === 'good-cost' ? 'text-cipher-mint' : ''}`}>{cost}</td>
                  <td className={`num ${mark === 'bad-clamp' ? 'text-ember' : mark === 'good-clamp' ? 'text-cipher-mint' : ''}`}>{clamp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3.5 text-center text-caption text-fog">
          Table 2. Fixed vs adaptive guard band (replay benchmark). The adaptive policy wins on
          cost or on quality on every trace, and on both for calm input.
        </p>
      </Reveal>

      <Reveal className="mx-auto mt-10 max-w-[760px] text-left">
        <p className="text-pebble">
          Measurement caveat, stated plainly: the without-warp figure is a directly measured
          staleness; the with-warp figure is the display-frame interval — a proxy floor that
          excludes mouse polling, GPU queueing and display scanout, none of which a browser can
          observe. All comparative claims are between quantities measured the same way.
        </p>
      </Reveal>
    </section>
  );
}

function Limits() {
  return (
    <section id="limits" className="mx-auto mt-[120px] max-w-[1200px] px-6">
      <SectionHead eyebrow="Limitations" title="What does not survive the network"
        lede="The honest capability table — rotation-only reprojection cannot compensate everything, and the report says exactly what breaks where." />
      <Reveal className="mx-auto mt-10 max-w-[880px]">
        <div className="plate-card overflow-x-auto">
          <table>
            <thead><tr><th>Capability</th><th>Local demo</th><th>Cloud demo</th><th>Why</th></tr></thead>
            <tbody>
              {[
                ['Rotation warp', 'Yes', 'Yes', 'Needs only the pose delta', false],
                ['Guard band', 'Yes', 'Yes', 'Server renders wide FOV; client crops', false],
                ['Motion vectors', 'Yes', 'No', 'YUV 4:2:0 video has no channel for per-pixel velocity', true],
                ['De-ghosting clamp', 'Yes', 'Inert', 'With no velocity term the clamp is mathematically a no-op', true],
              ].map(([cap, local, cloud, why, bad]) => (
                <tr key={cap}>
                  <td>{cap}</td>
                  <td className="text-cipher-mint">{local}</td>
                  <td className={bad ? 'text-ember' : 'text-cipher-mint'}>{cloud}</td>
                  <td>{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3.5 text-center text-caption text-fog">Table 3. Honest capability table.</p>
      </Reveal>

      <motion.div
        className="mx-auto mt-8 flex max-w-[760px] flex-col gap-3 text-left"
        variants={staggerParent(0, 0.08)} initial="hidden" whileInView="show"
        viewport={{ once: true, margin: '-80px' }}
      >
        {[
          ['Rotation only.', 'Object motion, disocclusion and translation parallax are not compensated; the moving target visibly steps at the source rate in the cloud demo.'],
          ['Proxy floor.', 'The warped-latency figure is not hardware motion-to-photon; establishing the absolute figure requires external instrumentation (photodiode or high-speed camera).'],
          ['Simulation-level adaptive result.', 'A real video encoder reacts to mid-stream FOV changes; the surviving saving must be measured in the live cloud pipeline before being quoted as a systems result.'],
          ['Cold flicks.', 'The window-max velocity estimator adapts one frame late to a flick from rest; the safety factor bounds, but does not eliminate, first-frame clamping on pathological input.'],
        ].map(([head, rest]) => (
          <motion.div key={head} variants={staggerChild(false)}
            className="rounded-badges bg-graphite-plate/55 p-4 text-body-sm text-pebble shadow-subtle-3">
            <strong className="font-semibold text-ice">{head}</strong> {rest}
          </motion.div>
        ))}
      </motion.div>

      <Reveal className="mx-auto mt-8 max-w-[760px] text-left">
        <p className="text-pebble">
          <strong className="font-semibold text-ice">Future work:</strong> hardware ground-truth
          instrumentation, a controlled user study (within-subjects, warp × delay × jitter),
          depth-aware streamed reprojection that turns the parallax error term into signal, a
          tangent-exact per-pixel remap, and a WebTransport port as the protocol matures.
        </p>
      </Reveal>
    </section>
  );
}

function Conclusion() {
  const reduce = useReducedMotion();
  return (
    <section id="conclusion" className="mx-auto mt-[120px] max-w-[1200px] px-6 text-center">
      <SectionHead eyebrow="Conclusion" title="A working system and a defensible claim" />
      <Reveal className="mx-auto mt-6 max-w-[760px] text-left">
        <p>
          This project built, measured and analysed a client-side answer to motion-to-photon
          latency that works at the only place a streaming client can act: the final composite.
          A video stream that is genuinely hundreds of milliseconds old can be displayed with a
          view direction one display interval old — flat against network delay and provably
          indifferent to jitter — using no server modification beyond a wider field of view and
          an in-band frame tag.
        </p>
        <p className="mt-4 font-medium text-glacier">
          For camera rotation in cloud-streamed rendering, the latency the network adds does not
          have to be the latency the player feels.
        </p>
      </Reveal>
      <Reveal delay={0.1} className="mt-9">
        <Magnetic strength={0.3}>
          <motion.a whileTap={reduce ? undefined : { scale: 0.98 }} className="btn-primary"
            href="FrameWarp_Project_Report.pdf">Read the full report</motion.a>
        </Magnetic>
      </Reveal>
    </section>
  );
}

function References() {
  return (
    <section id="references" className="mx-auto mt-[120px] max-w-[1200px] px-6">
      <div className="text-center"><MaskReveal><span className="eyebrow">Selected references</span></MaskReveal></div>
      <Reveal className="mx-auto mt-8 max-w-[760px] text-left text-caption leading-relaxed text-fog">
        <ol className="list-decimal pl-7">
          {REFS.map((r) => <li key={r} className="mb-1.5">{r}</li>)}
        </ol>
        <p className="mt-3">The full report contains 28 references; see the PDF for the complete list.</p>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mt-[120px] border-t border-steel-border/60 px-6 pb-14 pt-12">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-start justify-between gap-6 font-mono text-caption tracking-[0.08em] text-fog">
        <div className="leading-7">
          FRAME WARP · PROJECT REPORT<br />
          ISAAC · URK23AI1035<br />
          B.TECH ARTIFICIAL INTELLIGENCE AND DATA SCIENCE
        </div>
        <div className="text-right leading-7">
          KARUNYA INSTITUTE OF TECHNOLOGY AND SCIENCES<br />
          COIMBATORE · JUNE 2026<br />
          <a className="text-frost-link hover:underline" href="FrameWarp_Project_Report.pdf">FRAMEWARP_PROJECT_REPORT.PDF</a>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================================
   App
   ========================================================================== */
export default function App() {
  const [zoom, setZoom] = useState(null);
  return (
    <>
      <ScrollProgress />
      <Backdrop />
      <main className="relative z-10">
        <Nav />
        <Hero />
        <StatChips />
        <Problem />
        <Idea />
        <Artefacts />
        <Analysis />
        <Results onZoom={setZoom} />
        <Limits />
        <Conclusion />
        <References />
      </main>
      <Footer />

      {/* Figure lightbox — layoutId morph from grid slot to fullscreen */}
      <AnimatePresence>
        {zoom && (
          <motion.div
            className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-midnight-ink/85 p-8 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={() => setZoom(null)}
          >
            <motion.img
              layoutId={zoom} src={zoom} alt="Figure, enlarged"
              className="max-h-full w-full max-w-[1100px] rounded-cards shadow-subtle-4"
              transition={{ layout: LAYOUT_SPRING }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
