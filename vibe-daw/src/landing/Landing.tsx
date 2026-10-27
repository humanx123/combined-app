import { Fragment, useEffect, useRef, useState, type AnimationEvent, type CSSProperties, type PointerEvent } from 'react';
import { LayeredWordmark, Wordmark } from '../brand/Wordmark';
import { MusicTheoryIdentity } from './MusicTheoryIdentity';
import { donationWallets } from './donations';
import './landing.css';

const REPO = 'https://github.com/cristonj/Vibe-DAW';

// Crops of the real studio from scripts/capture-landing-screenshots.mjs (npm run screenshots).
const SHOTS = {
  studio: { src: '/screenshots/studio.webp', width: 2880, height: 1800 },
  producer: { src: '/screenshots/producer.webp', width: 784, height: 1660 },
  inlineEdit: { src: '/screenshots/inline-edit.webp', width: 1124, height: 806 },
  pianoRoll: { src: '/screenshots/piano-roll.webp', width: 2060, height: 538 },
  drums: { src: '/screenshots/drums.webp', width: 2088, height: 332 },
  mixer: { src: '/screenshots/mixer.webp', width: 1220, height: 850 },
};

function Shot({ shot, alt, eager = false, className = '' }: { shot: typeof SHOTS[keyof typeof SHOTS]; alt: string; eager?: boolean; className?: string }) {
  return <img className={className} src={shot.src} width={shot.width / 2} height={shot.height / 2} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" {...(eager ? { fetchPriority: 'high' as const } : {})} />;
}

/** A scannable payment link, drawn as one path of dark modules. The encoder loads on first use. */
function Qr({ uri, name }: { uri: string; name: string }) {
  const [code, setCode] = useState<{ size: number; d: string } | 'error' | null>(null);
  useEffect(() => {
    let live = true;
    import('uqr').then(({ encode }) => {
      const { data, size } = encode(uri, { ecc: 'M', border: 0 });
      let d = '';
      data.forEach((row, y) => {
        for (let x = 0; x < size; x++) {
          if (!row[x]) continue;
          let run = 1;
          while (row[x + run]) run++;
          d += `M${x} ${y}h${run}v1h${-run}z`;
          x += run;
        }
      });
      if (live) setCode({ size, d });
    }, () => { if (live) setCode('error'); });
    return () => { live = false; };
  }, [uri]);
  if (code === 'error') return <p className="lp-qr-note">The QR code could not load. Copy the address instead.</p>;
  return <figure className="lp-qr">
    {/* Four modules of quiet zone, as scanners expect. */}
    {code ? <svg viewBox={`-4 -4 ${code.size + 8} ${code.size + 8}`} role="img" aria-label={`QR code for the ${name} address`} shapeRendering="crispEdges"><path d={code.d} /></svg> : <div className="lp-qr-wait" />}
    <figcaption>Scan with your {name} wallet app.</figcaption>
  </figure>;
}

/** Unfolds when opened and folds away when closed, then leaves the page. */
function QrPanel({ open, id, uri, name }: { open: boolean; id: string; uri: string; name: string }) {
  const [shown, setShown] = useState(open);
  useEffect(() => { if (open) setShown(true); }, [open]);
  if (!shown) return null;
  return <div className={`lp-qr-panel${open ? '' : ' closing'}`} id={id} aria-hidden={!open || undefined} onAnimationEnd={(e) => { if (!open && e.target === e.currentTarget) setShown(false); }}>
    <div><Qr uri={uri} name={name} /></div>
  </div>;
}

function Support() {
  const [copied, setCopied] = useState('');
  const [status, setStatus] = useState('');
  const [qr, setQr] = useState('');
  const copy = async (address: string) => {
    try { await navigator.clipboard.writeText(address); setCopied(address); setStatus('Address copied'); }
    catch { setStatus('Copy is unavailable. Select the address to copy it manually.'); }
  };
  if (!donationWallets.length) return null;
  return <div className="lp-wallets">
    <p className="lp-support-line">Support Vibe. Donations are optional. Use each coin’s listed network.</p>
    {donationWallets.map((wallet) => {
      const open = qr === wallet.name, panel = `qr-${wallet.name.toLowerCase()}`;
      return <div className="lp-wallet" key={wallet.name}>
        <span>{wallet.name}<small>{wallet.symbol}{wallet.network === wallet.name ? '' : ` · ${wallet.network}`}</small></span>
        <code>{wallet.address}</code>
        <button onClick={() => void copy(wallet.address)} aria-label={`Copy ${wallet.name} address`}>{copied === wallet.address ? 'Copied' : 'Copy'}</button>
        <button onClick={() => setQr(open ? '' : wallet.name)} aria-expanded={open} aria-controls={panel} aria-label={`${open ? 'Hide' : 'Show'} ${wallet.name} QR code`}>{open ? 'Hide QR' : 'Show QR'}</button>
        <QrPanel open={open} id={panel} uri={`${wallet.scheme}${wallet.address}${wallet.suffix ?? ''}`} name={wallet.name} />
      </div>;
    })}
    <span className="lp-status" role="status">{status}</span>
  </div>;
}

function Arrow() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5" /></svg>;
}

/** Bounce the letter under the pointer, and its glow with it. A class rather than :hover, so it finishes the bounce. */
const bop = (e: PointerEvent) => {
  const letter = (e.target as Element).closest<HTMLElement>('.vibe-letter, .lp-letter');
  if (!letter) return;
  const twins = letter.dataset.letter ? letter.parentElement!.querySelectorAll(`.vibe-letter[data-letter="${letter.dataset.letter}"]`) : [letter];
  twins.forEach((el) => el.classList.add('bop'));
};
const unbop = (e: AnimationEvent) => { if (e.animationName === 'lp-bop') (e.target as Element).classList.remove('bop'); };

/** Keep each animation's place while it is offscreen, including SVG color flow. */
function useVisibleMotion() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const groups = [...root.querySelectorAll<HTMLElement>('[data-lp-motion]')];
    const visible = new Set<Element>();
    const update = (el: Element) => {
      const active = visible.has(el) && !document.hidden;
      el.setAttribute('data-lp-motion', active ? 'running' : 'paused');
      for (const svg of el.querySelectorAll('svg')) {
        if (active) svg.unpauseAnimations?.();
        else svg.pauseAnimations?.();
      }
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
        update(entry.target);
      }
    }, { root, rootMargin: '160px' });
    groups.forEach((el) => observer.observe(el));
    const visibility = () => groups.forEach(update);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      // StrictMode remounts effects in development without remounting the SVG.
      for (const el of groups) {
        el.setAttribute('data-lp-motion', 'running');
        el.querySelectorAll('svg').forEach((svg) => svg.unpauseAnimations?.());
      }
    };
  }, []);
  return ref;
}

// Each lip span draws two copies (before and after), so these make eight steps down the depth.
const LIP_STEPS = [0.125, 0.375, 0.625, 0.875];

/** Text in the wordmark's ink, a span per letter; see `.lp-letter` in landing.css. */
function Promise({ text }: { text: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const mark = ref.current;
    if (!mark) return;
    // Each letter takes its slice of one gradient that spans the phrase.
    const measure = () => {
      const letters = [...mark.querySelectorAll<HTMLElement>('.lp-letter')];
      const first = letters[0], last = letters[letters.length - 1];
      if (!first || !last) return;
      for (const el of letters) el.style.setProperty('--x', `${el.offsetLeft - first.offsetLeft}px`);
      mark.style.setProperty('--w', `${Math.max(1, last.offsetLeft + last.offsetWidth - first.offsetLeft)}px`);
    };
    measure();
    document.fonts?.ready.then(measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (mark.parentElement) observer?.observe(mark.parentElement);
    return () => observer?.disconnect();
  }, []);
  let i = 0;
  const words = text.split(' ');
  return <mark ref={ref}>{words.map((word, w) => <Fragment key={w}>
    <span className="lp-word">{[...word].map((ch) => {
      const k = i++;
      // An estimate until measured, so the prerendered page starts close.
      return <span key={k} className="lp-letter" data-ch={ch} style={{ '--i': k, '--x': `${k * 0.52}em` } as CSSProperties}><span className="lp-face">{ch}</span>{LIP_STEPS.map((s) => <span key={s} className="lp-lip" data-ch={ch} style={{ '--s': s } as CSSProperties} />)}</span>;
    })}</span>{w < words.length - 1 && ' '}
  </Fragment>)}</mark>;
}

export function Landing() {
  const ref = useVisibleMotion();
  return <div className="landing" ref={ref}>
    <main>
      <section className="lp-hero lp-wrap">
        <div className="lp-aurora" data-lp-motion="running" aria-hidden><i /><i /><i /></div>
        <div className="lp-wordmark-wrap" data-lp-motion="running" onPointerOver={bop} onAnimationEnd={unbop}><LayeredWordmark className="lp-wordmark" flow={12} /></div>
        <h1 data-lp-motion="running" onPointerOver={bop} onAnimationEnd={unbop}>Make music.<br /><Promise text="Make it yours." /></h1>
        <div className="lp-hero-actions" data-lp-motion="running"><a className="lp-btn lp-cta" href="/studio"><span className="lp-cta-glow" aria-hidden /><span className="lp-cta-fill" aria-hidden /><span>Open the studio</span><Arrow /><span className="lp-sheen" aria-hidden /></a></div>
        <figure className="lp-hero-shot">
          <div className="lp-frame lp-bleed"><Shot eager shot={SHOTS.studio} alt="The Vibe studio: five tracks on the timeline with a new flute part outlined in the agent's gradient, the Producer's run and its Changes to review card on the right, and the mixer below." /></div>
        </figure>
      </section>

      <section className="lp-split lp-wrap lp-reveal">
        <div className="lp-copy">
          <h2 onPointerOver={bop} onAnimationEnd={unbop}><Promise text="Describe it." /><br />Build it together.</h2>
        </div>
        <figure className="lp-frame lp-producer"><Shot shot={SHOTS.producer} alt="The Producer panel: a request for a breathy flute melody, the tools it used, its mix review, its reply, and the Changes to review card with Undo all and Keep." /></figure>
      </section>

      <section className="lp-band lp-reveal">
        <div className="lp-split lp-wrap reverse">
          <figure className="lp-frame lp-inline"><Shot shot={SHOTS.inlineEdit} alt="Four bars of bass and pad selected across two tracks with the inline edit box open: Walk the bass up into the hook." /></figure>
          <div className="lp-copy">
            <h2 onPointerOver={bop} onAnimationEnd={unbop}>Select it.<br /><Promise text="Shape it." /></h2>
          </div>
        </div>
      </section>

      <section className="lp-daw lp-wrap">
        <div className="lp-grid">
          <figure className="lp-frame wide lp-reveal"><Shot shot={SHOTS.drums} alt="The step sequencer with kick, snare, hat, rim and shaker lanes." /></figure>
          <figure className="lp-frame wide lp-reveal"><Shot shot={SHOTS.pianoRoll} alt="The piano roll showing the flute melody with note velocities." /></figure>
          <figure className="lp-frame lp-mixer lp-reveal"><Shot shot={SHOTS.mixer} alt="The mixer with a channel strip for each track and the master bus." /></figure>
          <div className="lp-promise lp-reveal">
            <h3>Real notes.<br />Real instruments.</h3>
          </div>
        </div>
      </section>

      <section className="lp-end lp-wrap" id="support">
        <h2>Free and open source.</h2>
        <p className="lp-key-note">The AI Producer uses your own Gemini API key.</p>
        <div className="lp-actions" data-lp-motion="running"><a className="lp-btn lp-cta" href="/studio"><span className="lp-cta-glow" aria-hidden /><span className="lp-cta-fill" aria-hidden /><span>Open the studio</span><Arrow /><span className="lp-sheen" aria-hidden /></a><a className="lp-btn ghost" href={REPO} target="_blank" rel="noreferrer">Star it on GitHub</a></div>
        <Support />
      </section>

      <section className="lp-theory lp-wrap lp-reveal" aria-labelledby="lp-theory-title">
        <div className="lp-theory-brand">
          <MusicTheoryIdentity />
          <picture className="lp-theory-screen"><source media="(max-width:720px)" srcSet="/related/musictheory-lesson-phone.webp" /><img className="lp-theory-shot" src="/related/musictheory-lesson.webp" width="1280" height="900" loading="lazy" decoding="async" alt="A real MusicTheory.Work lesson teaching C with a playable piano keyboard" /></picture>
        </div>
        <div className="lp-copy">
          <h2 id="lp-theory-title">Learn music theory.</h2>
          <a className="lp-btn ghost" href="https://musictheory.work/" target="_blank" rel="noopener noreferrer">Start learning <Arrow /></a>
        </div>
      </section>

    </main>
    <footer className="lp-legal lp-wrap" aria-label="Footer">
      <div className="lp-footer-brands"><a href="/" aria-label="Vibe home"><Wordmark className="lp-footer-vibe" label="" glow /></a><a href="https://musictheory.work/" target="_blank" rel="noopener noreferrer" aria-label="MusicTheory.Work"><img src="/related/musictheory-wordmark.svg" width="1144" height="120" alt="" /></a></div>
      <div className="lp-footer-links"><a href="/terms/">Terms</a><a href="/privacy/">Privacy</a><a href={REPO} target="_blank" rel="noreferrer">GitHub</a></div>
      <p>Created by <a href="https://www.linkedin.com/in/criston-jackson/">Criston Jackson</a></p>
    </footer>
  </div>;
}
