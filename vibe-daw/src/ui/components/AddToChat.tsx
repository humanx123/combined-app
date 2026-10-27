import { MessageSquarePlus } from '../icons';
import { attachChatReference } from '../chatReferences';

export function AddToChat({ referenceId, label, mini = false }: { referenceId: string; label: string; mini?: boolean }) {
  return <button className={mini ? 'add-mini' : 'btn icon'} title={`Add ${label} to chat`} aria-label={`Add ${label} to chat`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); attachChatReference(referenceId); }}><MessageSquarePlus size={12} /></button>;
}
