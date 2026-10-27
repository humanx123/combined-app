import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useDaw } from '../../state/store';
import { findClip } from '../../model/project';
import { runAgent, useAgent } from '../../agent/agent';
import { selectionClips, selectedNotes, type EditSelection } from '../../model/selection';
import { shuffledSuggestions } from '../../agent/suggestions';
import { Shuffle } from '../icons';

// Ctrl+K: Cursor-style inline edit, scoped to the selected clips.

const useInline = create<{ selection: EditSelection | null }>(() => ({ selection: null }));

export function openInlineAI(clipIds?: string[]) {
  const current = useDaw.getState().selection;
  const selection = clipIds && !clipIds.every((id) => current.clipIds.includes(id))
    ? { clipIds } : { ...current, clipIds: clipIds ?? current.clipIds };
  useInline.setState({ selection: structuredClone(selection) });
}

export function InlineAI() {
  const selection = useInline((s) => s.selection);
  const clipIds = selection ? selectionClips(useDaw.getState().project, selection) : null;
  const running = useAgent((s) => s.running);
  const project = useDaw((s) => s.project);
  const [text, setText] = useState('');
  const [quick, setQuick] = useState(() => shuffledSuggestions('midi'));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selection) return;
    const p = useDaw.getState().project;
    const first = findClip(p, selectionClips(p, selection)[0]);
    const kind = first?.clip.type === 'audio' ? 'audio' : first?.track.kind === 'drums' ? 'drums' : 'midi';
    setText(''); setQuick(shuffledSuggestions(kind));
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [selection]);

  if (!clipIds) return null;
  const found = clipIds.map((id) => findClip(project, id)).filter((x): x is NonNullable<typeof x> => !!x);
  const kind = found[0] ? (found[0].clip.type === 'audio' ? 'audio' : found[0].track.kind === 'drums' ? 'drums' : 'midi') : 'midi';
  const noteCount = selection ? found.reduce((sum, f) => sum + selectedNotes(project, selection, f.clip.id).length, 0) : 0;
  const close = () => useInline.setState({ selection: null });
  const submit = (t: string) => {
    if (!t.trim()) return;
    close();
    void runAgent(t, { focusSelection: selection!, mode: 'agent' });
  };

  return (
    <div className="overlay clear" style={{ background: 'rgba(0,0,0,0.35)', placeItems: 'start center' }} onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="inline-ai" role="dialog" aria-modal="true" aria-label="Edit with AI">
        <div className="ctx">
          {selection?.range || selection?.notes?.length ? `${noteCount} selected notes${selection.range ? ` · beats ${selection.range.start}–${selection.range.end}` : ''} · ${found.length} clips` : found.length ? `Editing ${found.map((f) => `“${f.clip.name}” (${f.track.name})`).join(', ')}` : 'No clip selected - this will go to the agent for the whole song'}
        </div>
        <input
          ref={inputRef}
          value={text}
          placeholder={found.length ? 'What should change?' : 'Ask the agent…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(text); if (e.key === 'Escape') { e.stopPropagation(); close(); } }}
          aria-label="Instruction"
        />
        <div className="suggestions" style={{ marginTop: 8 }}>
          {quick.map((q) => <button key={q} className="suggestion" onClick={() => submit(q)}>{q}</button>)}
        </div>
        <button className="btn" onClick={() => setQuick(shuffledSuggestions(kind))}><Shuffle size={13} /> More ideas</button>
        <div className="hint">{running ? 'Enter to steer the active run' : 'Enter to run'} · Esc to close · changes stay outlined until you keep them</div>
      </div>
    </div>
  );
}
