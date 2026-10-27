import { describe, expect, it, vi } from 'vitest';
vi.mock('../engine/api', () => ({ play: vi.fn(), stop: vi.fn(), renderProject: vi.fn() }));
vi.mock('../agent/ears', () => ({ audition: vi.fn(), listen: vi.fn() }));
import { useSettings } from '../state/settings';
import { toolDeclarations } from '../agent/tools';
import { TOOL_ICONS } from './toolIcons';

describe('tool icons', () => {
  it('gives every agent tool an icon in the chat', () => {
    useSettings.setState({ autoListen: true });
    const missing = toolDeclarations('agent').map((t) => t.name).filter((name) => !TOOL_ICONS[name]);
    expect(missing).toEqual([]);
  });
});
