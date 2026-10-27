import { useState, type CSSProperties } from 'react';
import { ArrowLeftRight, Dices, Plus, X } from '../icons';
import { GRADIENT_PRESETS, MAX_STOPS, SOLID_PRESETS, accentFill, accentStops, colorAt, randomStops, stopsToAccent } from '../../state/accent';
import { useTheme } from '../../state/theme';

/** Presets, a gradient you can build stop by stop, and a dice roll. Every change applies live. */
export function AccentPicker() {
  const accent = useTheme((s) => s.accent);
  const set = useTheme((s) => s.set);
  const [rolls, setRolls] = useState(0);
  const stops = accentStops(accent);
  const apply = (next: string[]) => set({ accent: stopsToAccent(next) });
  // The bar samples four colors into animatable custom properties, so changes morph.
  const morph = Object.fromEntries([0, 1, 2, 3].map((k) => [`--s${k}`, colorAt(stops, k / 3)])) as CSSProperties;
  const swatch = (value: string, label: string) => (
    <button key={value} className={`accent-dot ${accent === value ? 'on' : ''}`} style={{ background: accentFill(value) }} onClick={() => set({ accent: value })} aria-label={label} aria-pressed={accent === value} title={label} />
  );

  return (
    <div className="accent-picker">
      <div className="accent-row" role="group" aria-label="Accent presets">
        {GRADIENT_PRESETS.map((p) => swatch(p.accent, `${p.name} gradient`))}
        <i className="accent-sep" aria-hidden />
        {SOLID_PRESETS.map((c) => swatch(c, `Solid ${c}`))}
      </div>

      <div className="accent-maker">
        <div className="accent-bar" style={morph}>
          {stops.map((color, k) => (
            <div key={k} className="accent-stop" style={{ left: stops.length === 1 ? '50%' : `${(k / (stops.length - 1)) * 100}%` }}>
              <label style={{ background: color }} title="Change this color">
                <input type="color" value={color} onChange={(e) => apply(stops.map((c, j) => (j === k ? e.target.value : c)))} aria-label={`Color ${k + 1} of ${stops.length}`} />
              </label>
              {stops.length > 1 && <button className="accent-stop-x" onClick={() => apply(stops.filter((_, j) => j !== k))} aria-label={`Remove color ${k + 1}`}><X size={10} /></button>}
            </div>
          ))}
        </div>
        <div className="accent-tools">
          <button className="btn" onClick={() => apply([...stops, randomStops()[0]])} disabled={stops.length >= MAX_STOPS}><Plus size={14} /> Add color</button>
          <button className="btn" onClick={() => apply([...stops].reverse())} disabled={stops.length < 2}><ArrowLeftRight size={14} /> Flip</button>
          <button className="btn" onClick={() => { setRolls((r) => r + 1); apply(randomStops()); }}><Dices key={rolls} size={14} className={rolls ? 'accent-dice' : ''} /> Surprise me</button>
        </div>
      </div>

      <div className="accent-preview" aria-hidden>
        <div className="accent-clip"><span>Hook melody</span><i>AI</i></div>
        <span className="btn primary">Keep</span>
        <span className="ai-ink">Edit with AI</span>
      </div>
    </div>
  );
}
