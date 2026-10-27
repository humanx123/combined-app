import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BRAND_GLYPHS, MONOGRAM_PATHS } from './mtwBrand';

function place(path: string, scale: number, x: number, y: number) {
  let command = '', index = 0;
  return (path.match(/[MLHVQZ]|-?\d+(?:\.\d+)?/g) ?? []).map(token => {
    if (/^[A-Z]$/.test(token)) { command = token; index = 0; return token; }
    const vertical = command === 'V' || (command !== 'H' && index++ % 2 === 1);
    return String(Math.round((Number(token) * scale + (vertical ? y : x)) * 1000) / 1000);
  }).join(' ');
}

interface Piece { id: string; path: string; markPath?: string; stroke: number; order: number; dot: boolean; x: number; y: number }
const PIECES: Piece[] = [];
let order = 0;
for (const [text, width, top] of [['MusicTheory', 1120, 0], ['.Work', 800, 215]] as const) {
  const scale = width / [...text].reduce((sum, letter) => sum + BRAND_GLYPHS[letter].width + 5, 0);
  let left = (1120 - width) / 2;
  for (const [index, letter] of [...text].entries()) {
    const glyph = BRAND_GLYPHS[letter];
    const anchor = letter === 'M' ? 0 : letter === 'T' ? 1 : letter === 'W' ? 2 : -1;
    const targets = anchor >= 0 ? MONOGRAM_PATHS[anchor].match(/M[^M]+/g) ?? [] : [];
    (glyph.path.match(/M[^M]+/g) ?? []).forEach((path, part) => PIECES.push({ id: `${text}-${index}-${part}`, path: place(path, scale, left, top), markPath: targets[part] ? place(targets[part], .8, 355, 0) : undefined, stroke: 14 * scale, order: order + part * .18, dot: false, x: left + glyph.width * scale / 2, y: top + 60 * scale }));
    if (letter === 'i' || letter === '.') {
      const y = letter === 'i' ? 9 : 78;
      PIECES.push({ id: `${text}-${index}-dot`, path: place(`M7 ${y}H21V${y + 14}H7Z`, scale, left, top), stroke: 0, order: order + .8, dot: true, x: left + 14 * scale, y: top + (y + 7) * scale });
    }
    left += (glyph.width + 5) * scale;
    order++;
  }
}

/** The same individually tumbling vectors and path morphs used by MTW's own hero. */
export function MusicTheoryIdentity() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [entered, setEntered] = useState(false);
  const [active, setActive] = useState(false);
  const [mark, setMark] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let visible = false;
    const update = () => setActive(visible && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) setEntered(true);
      update();
    }, { rootMargin:'80px' });
    observer.observe(node);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  const moving = entered && !reduced;
  const showMark = moving && mark;
  useEffect(() => {
    if (!active || !moving) return;
    const timer = setInterval(() => setMark(value => !value), 5000);
    return () => clearInterval(timer);
  }, [active, moving]);
  return <div ref={ref} className="mtw-identity">
    <svg role="img" aria-label="MusicTheory.Work" viewBox="-12 -12 1144 494" data-identity-state={showMark ? 'monogram' : 'wordmark'}>
      {PIECES.map(piece => {
        const hidden = showMark && !piece.markPath;
        const angle = (Math.floor(piece.order) % 2 ? 1 : -1) * (18 + (piece.order * 11) % 25);
        return <motion.g key={`${piece.id}-${moving}`} data-brand-piece={piece.dot ? 'dot' : 'letter'} style={{ transformOrigin:`${piece.x}px ${piece.y}px` }}
          initial={moving ? { y:-190 - (piece.order % 3) * 35, rotate:angle, opacity:0 } : false}
          animate={!moving ? { y:0, x:0, scale:1, rotate:0, opacity:1 } : hidden ? { y:170 - piece.y, x:560 - piece.x, scale:.25, rotate:angle, opacity:0 } : piece.markPath ? { y:0, x:0, scale:1, rotate:0, opacity:1 } : { y:[-190 - (piece.order % 3) * 35, 0, -10, 0, -2, 0], x:0, scale:1, rotate:[angle, -angle * .1, 2, 0, 0, 0], opacity:[0, 1, 1, 1, 1, 1] }}
          transition={!moving ? { duration:0 } : hidden ? { duration:.65, ease:'easeInOut', delay:piece.order * .012 } : piece.markPath ? { type:'spring', stiffness:100, damping:17, mass:1.3 } : { duration:1.25, delay:piece.order * .035 + (piece.dot ? .16 : 0), times:[0,.55,.7,.85,.93,1], ease:['easeIn','easeOut','easeIn','easeOut','easeIn'] }}>
          <motion.path d={piece.path} animate={{ d:showMark && piece.markPath ? piece.markPath : piece.path, strokeWidth:showMark && piece.markPath ? 27.2 : piece.stroke }} transition={{ duration:moving ? 1.05 : 0, ease:[.65,0,.2,1] }} fill={piece.dot ? '#b6adff' : 'none'} stroke={piece.dot ? 'none' : 'currentColor'} strokeWidth={piece.stroke} strokeLinecap="butt" strokeLinejoin="round" />
        </motion.g>;
      })}
    </svg>
  </div>;
}
