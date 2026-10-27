import type { ComponentType, ReactNode, SVGProps } from 'react';

// Vibe's icon set, drawn for the wordmark: solid duotone shapes on a 24px grid. Each icon has a
// solid main shape in the text color and a softer supporting tone at 40%, with round-capped
// strokes where a line reads better than a fill. Faded parts that touch are grouped so they fade
// as one piece. In the agent's contexts (see global.css) icons paint the accent gradient from
// <IconDefs />.

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & { size?: number | string; color?: string };
export type Icon = ComponentType<IconProps>;

/** The solid main shape. */
const solid = { fill: 'currentColor', stroke: 'none' } as const;
/** The supporting tone. */
const soft = { ...solid, opacity: 0.4 } as const;
/** Arrowheads: filled, with a thin round-joined stroke to soften the corners. */
const head = { fill: 'currentColor', strokeWidth: 1.6 } as const;

function icon(name: string, body: ReactNode): Icon {
  const Component = ({ size = 24, color = 'currentColor', className, ...rest }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
      className={className ? `icon ${className}` : 'icon'} aria-hidden={rest['aria-label'] ? undefined : true} {...rest}
    >{body}</svg>
  );
  Component.displayName = name;
  return Component;
}

/** The shared gradient agent icons paint with. Its stops follow the accent (see theme.ts). */
export function IconDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
      <defs>
        <linearGradient id="vibe-ink" gradientUnits="userSpaceOnUse" x1="3" y1="3" x2="21" y2="21">
          <stop offset="0" style={{ stopColor: 'var(--ink-0)' }} />
          <stop offset="0.5" style={{ stopColor: 'var(--ink-1)' }} />
          <stop offset="1" style={{ stopColor: 'var(--ink-2)' }} />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Transport and playback
export const Play = icon('Play', <path {...solid} d="M7 5.6c0-1.4 1.5-2.2 2.7-1.5l10.2 6.4c1.1.7 1.1 2.3 0 3L9.7 19.9C8.5 20.6 7 19.8 7 18.4z" />);
export const Pause = icon('Pause', <><rect {...solid} x="5.5" y="4" width="5" height="16" rx="2.5" /><rect {...solid} x="13.5" y="4" width="5" height="16" rx="2.5" /></>);
export const Square = icon('Square', <rect {...solid} x="5" y="5" width="14" height="14" rx="4" />);
export const CircleStop = icon('CircleStop', <><circle {...soft} cx="12" cy="12" r="10" /><rect {...solid} x="8.5" y="8.5" width="7" height="7" rx="2" /></>);
export const SkipBack = icon('SkipBack', <><rect {...solid} x="4" y="5" width="3.6" height="14" rx="1.8" /><path {...solid} d="M20 6.6c0-1.3-1.4-2.1-2.5-1.4l-7.7 5c-1 .7-1 2.2 0 2.9l7.7 5c1.1.7 2.5-.1 2.5-1.4z" /></>);
export const Repeat = icon('Repeat', <><path strokeWidth="2.5" d="M4.5 12.5V11a4 4 0 0 1 4-4h7.5" /><path {...head} d="M16.4 3.8 20.6 7l-4.2 3.2z" /><g opacity=".5"><path strokeWidth="2.5" d="M19.5 11.5V13a4 4 0 0 1-4 4H8" /><path {...head} d="M7.6 13.8 3.4 17l4.2 3.2z" /></g></>);
export const Metronome = icon('Metronome', <><path {...soft} d="M9.6 2.5h4.8c.9 0 1.6.6 1.8 1.4l3.2 13.6H4.6L7.8 3.9c.2-.8.9-1.4 1.8-1.4z" /><rect {...solid} x="3.5" y="17.5" width="17" height="4" rx="1.6" /><path d="M12 15.5l5.6-9.8" strokeWidth="2.3" /><circle {...solid} cx="15.5" cy="9.4" r="2.3" /></>);
export const Gauge = icon('Gauge', <><path d="M5.3 18.7a9.5 9.5 0 1 1 13.4 0" strokeWidth="3.2" opacity=".4" /><path d="M5.3 18.7A9.5 9.5 0 0 1 9 5" strokeWidth="3.2" /><path d="M12 13.5l4-4.6" strokeWidth="2.6" /><circle {...solid} cx="12" cy="13.5" r="2.5" /></>);
export const AudioLines = icon('AudioLines', <><rect {...soft} x="2.6" y="9.5" width="2.8" height="5" rx="1.4" /><rect {...solid} x="6.7" y="6" width="2.8" height="12" rx="1.4" /><rect {...solid} x="10.6" y="2.5" width="2.8" height="19" rx="1.4" /><rect {...solid} x="14.5" y="7" width="2.8" height="10" rx="1.4" /><rect {...soft} x="18.6" y="9" width="2.8" height="6" rx="1.4" /></>);
export const Music = icon('Music', <><path {...soft} d="M9 6.2c0-.9.6-1.6 1.4-1.8l8-2c1-.2 2 .5 2 1.6V7l-11.4 2.8z" /><path d="M9.6 8.5V17M19.4 5.5v9.5" strokeWidth="2.4" /><ellipse {...solid} cx="7" cy="17.6" rx="3.2" ry="2.6" transform="rotate(-18 7 17.6)" /><ellipse {...solid} cx="16.8" cy="15.2" rx="3.2" ry="2.6" transform="rotate(-18 16.8 15.2)" /></>);
export const Piano = icon('Piano', <path {...solid} fillRule="evenodd" d="M6 3.5h12a3.5 3.5 0 0 1 3.5 3.5v10a3.5 3.5 0 0 1-3.5 3.5H6A3.5 3.5 0 0 1 2.5 17V7A3.5 3.5 0 0 1 6 3.5zM7.2 3.5v8.3a1 1 0 0 0 1 1h1.4a1 1 0 0 0 1-1V3.5zm6.2 0v8.3a1 1 0 0 0 1 1h1.4a1 1 0 0 0 1-1V3.5zM11.35 12.8v7.7h1.3v-7.7z" />);
export const Drum = icon('Drum', <><path {...soft} d="M3 10v6c0 2.2 4 4 9 4s9-1.8 9-4v-6z" /><ellipse {...solid} cx="12" cy="10" rx="9" ry="3.6" /><path d="M5.5 3.5 10 8.5M18.5 3.5 14 8.5" strokeWidth="2.2" /><circle {...solid} cx="5" cy="3" r="1.6" /><circle {...solid} cx="19" cy="3" r="1.6" /></>);
export const Mic = icon('Mic', <><rect {...solid} x="8" y="2" width="8" height="13" rx="4" /><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V22" strokeWidth="2.2" opacity=".45" /></>);
export const Ear = icon('Ear', <><path {...solid} fillRule="evenodd" d="M8 9.8C8 6 11 3 14.6 3c3.7 0 6.6 2.8 6.6 6.5 0 3-1.5 4.5-2.7 5.8-1 1.1-1.5 1.9-1.5 3.2 0 2.7-2 4.5-4.5 4.5-2 0-3.6-1.2-4.2-3l2.6-.9c.3.8 1 1.3 1.7 1.3 1 0 1.7-.8 1.7-2 0-2.3 1-3.6 2.3-5 1.2-1.3 2.2-2.3 2.2-4.6 0-2.2-1.7-4-4-4-2.4 0-4 1.8-4 4.4z" /><path d="M12.7 10c0-1.1.8-1.9 1.9-1.9 1.1 0 1.9.9 1.7 2-.2 1.2-1.2 1.7-1.9 2.4" strokeWidth="2.1" /><path d="M5.4 9.2c-.9 1.8-.9 3.8 0 5.6M2.8 7.5c-1.6 2.8-1.6 6.2 0 9" strokeWidth="2" opacity=".45" /></>);

// Editing
export const Plus = icon('Plus', <path strokeWidth="2.6" d="M12 4.5v15M4.5 12h15" />);
export const X = icon('X', <path strokeWidth="2.6" d="M6 6l12 12M18 6 6 18" />);
export const Check = icon('Check', <path strokeWidth="2.8" d="M4.5 12.8 9.6 18 19.5 6.5" />);
export const Pencil = icon('Pencil', <><path {...solid} d="M15.3 3.9a2.6 2.6 0 0 1 3.7 0l1.1 1.1a2.6 2.6 0 0 1 0 3.7l-1.6 1.6-4.8-4.8z" /><path {...soft} d="M12.4 6.8l4.8 4.8-8.9 8.9a2 2 0 0 1-1 .5l-3.8.8a.8.8 0 0 1-.9-.9l.8-3.8a2 2 0 0 1 .5-1z" /></>);
export const Trash = icon('Trash', <><path {...solid} d="M9.5 3.5c0-.8.7-1.5 1.5-1.5h2c.8 0 1.5.7 1.5 1.5V5h4.8a1.3 1.3 0 0 1 0 2.6H4.7a1.3 1.3 0 0 1 0-2.6h4.8z" /><path {...soft} d="M5.6 9h12.8l-.9 10.3a2.6 2.6 0 0 1-2.6 2.4H9.1a2.6 2.6 0 0 1-2.6-2.4z" /><path strokeWidth="2" d="M10 12.5v5M14 12.5v5" /></>);
export const Scissors = icon('Scissors', <><path strokeWidth="2.4" d="M8.6 8.4 20 17.6M8.6 15.6 20 6.4" /><path {...solid} fillRule="evenodd" d="M2.7 6.3a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0-6.6 0zM4.7 6.3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0zM2.7 17.7a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0-6.6 0zM4.7 17.7a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0z" /></>);
export const Copy = icon('Copy', <><rect {...soft} x="3" y="3" width="12" height="12" rx="3" /><rect {...solid} x="9" y="9" width="12" height="12" rx="3" /></>);
export const CopyPlus = icon('CopyPlus', <><rect {...soft} x="3" y="3" width="12" height="12" rx="3" /><path {...solid} fillRule="evenodd" d="M12 9h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3zm2 3.2v1.6h-1.6a1.2 1.2 0 0 0 0 2.4H14v1.6a1.2 1.2 0 0 0 2.4 0v-1.6H18a1.2 1.2 0 0 0 0-2.4h-1.6v-1.6a1.2 1.2 0 0 0-2.4 0z" /></>);
export const ClipboardPaste = icon('ClipboardPaste', <><path {...soft} d="M7 4h10a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" /><rect {...solid} x="8" y="2" width="8" height="5" rx="1.8" /><path strokeWidth="2.4" d="M12 10v6.5" /><path {...solid} d="M12 19.6c-.3 0-.6-.1-.8-.4l-2.6-3c-.5-.6 0-1.6.8-1.6h5.2c.8 0 1.3 1 .8 1.6l-2.6 3c-.2.3-.5.4-.8.4z" /></>);
export const RotateCcw = icon('RotateCcw', <><path strokeWidth="2.6" d="M5.5 13a7 7 0 1 0 2-5.5" /><path {...solid} d="M3.6 4.2c0-.9 1.1-1.4 1.8-.7l4 4c.6.6.2 1.7-.7 1.7h-4a1.1 1.1 0 0 1-1.1-1.1z" /></>);
export const Undo2 = icon('Undo2', <><path strokeWidth="2.6" d="M7 9.5h7.5a5 5 0 0 1 0 10H10" /><path {...solid} d="M2.9 9.5c0-.3.1-.6.4-.8l4.2-3.6c.7-.6 1.8-.1 1.8.8v7.2c0 .9-1.1 1.4-1.8.8l-4.2-3.6c-.3-.2-.4-.5-.4-.8z" /></>);
export const Redo2 = icon('Redo2', <><path strokeWidth="2.6" d="M17 9.5H9.5a5 5 0 0 0 0 10H14" /><path {...solid} d="M21.1 9.5c0-.3-.1-.6-.4-.8l-4.2-3.6c-.7-.6-1.8-.1-1.8.8v7.2c0 .9 1.1 1.4 1.8.8l4.2-3.6c.3-.2.4-.5.4-.8z" /></>);
export const MousePointer2 = icon('MousePointer2', <path {...solid} d="M4.6 3.3l15.3 6.3c1 .4.9 1.8-.1 2.1l-6 1.9-2 5.9c-.3 1-1.7 1.1-2.1.1L3.4 4.5c-.4-.8.4-1.6 1.2-1.2z" />);
export const SlidersHorizontal = icon('SlidersHorizontal', <><path strokeWidth="2.4" opacity=".45" d="M3.5 7h17M3.5 17h17" /><rect {...solid} x="12" y="3.8" width="5.5" height="6.4" rx="2.2" /><rect {...solid} x="6.5" y="13.8" width="5.5" height="6.4" rx="2.2" /></>);
export const ZoomIn = icon('ZoomIn', <><circle {...soft} cx="10.5" cy="10.5" r="7.5" /><circle strokeWidth="2.4" cx="10.5" cy="10.5" r="6.5" /><path strokeWidth="3" d="M16 16l4.5 4.5" /><path strokeWidth="2.2" d="M10.5 7.5v6M7.5 10.5h6" /></>);
export const ZoomOut = icon('ZoomOut', <><circle {...soft} cx="10.5" cy="10.5" r="7.5" /><circle strokeWidth="2.4" cx="10.5" cy="10.5" r="6.5" /><path strokeWidth="3" d="M16 16l4.5 4.5" /><path strokeWidth="2.2" d="M7.5 10.5h6" /></>);
export const Search = icon('Search', <><circle {...soft} cx="10.5" cy="10.5" r="7.5" /><circle strokeWidth="2.4" cx="10.5" cy="10.5" r="6.5" /><path strokeWidth="3" d="M16 16l4.5 4.5" /><path strokeWidth="1.8" d="M7.3 9.5a3.3 3.3 0 0 1 2.2-2.2" /></>);
export const Shuffle = icon('Shuffle', <><path strokeWidth="2.5" d="M3.5 17h1.8c2 0 3.2-1 4.2-2.6l2.4-3.9c1-1.6 2.2-2.5 4.2-2.5h.3" /><path {...head} d="M16.4 4.3 20.6 7.5l-4.2 3.2z" /><g opacity=".5"><path strokeWidth="2.5" d="M3.5 7.5h1.8c1 0 1.8.3 2.5.8M13 15.8c.8.8 1.8 1.2 3 1.2h.4" /><path {...head} d="M16.4 13.8 20.6 17l-4.2 3.2z" /></g></>);
export const ArrowLeftRight = icon('ArrowLeftRight', <><path strokeWidth="2.5" d="M3.5 8h11" /><path {...head} d="M15.6 4.6 20 8l-4.4 3.4z" /><g opacity=".5"><path strokeWidth="2.5" d="M20.5 16h-11" /><path {...head} d="M8.4 12.6 4 16l4.4 3.4z" /></g></>);
export const ArrowUp = icon('ArrowUp', <><path strokeWidth="2.6" d="M12 20V6" /><path {...solid} d="M12 2.8c.5 0 .9.2 1.2.5l5.3 5.6c.8.9.2 2.3-1 2.3H6.5c-1.2 0-1.8-1.4-1-2.3l5.3-5.6c.3-.3.7-.5 1.2-.5z" /></>);
export const ChevronDown = icon('ChevronDown', <path strokeWidth="2.6" d="M6 9.5l6 6 6-6" />);
export const ChevronUp = icon('ChevronUp', <path strokeWidth="2.6" d="M6 14.5l6-6 6 6" />);
export const Ellipsis = icon('Ellipsis', <><circle {...solid} cx="5" cy="12" r="2.3" /><circle {...solid} cx="12" cy="12" r="2.3" /><circle {...solid} cx="19" cy="12" r="2.3" /></>);

// Panels, files, and places
export const PanelLeft = icon('PanelLeft', <><rect strokeWidth="2.2" x="2.5" y="3.5" width="19" height="17" rx="4.5" /><rect {...solid} x="5.6" y="6.6" width="4.6" height="10.8" rx="1.7" /><path strokeWidth="2" opacity=".4" d="M13.5 9.5h4.5M13.5 14.5h3" /></>);
export const PanelRight = icon('PanelRight', <><rect strokeWidth="2.2" x="2.5" y="3.5" width="19" height="17" rx="4.5" /><rect {...solid} x="13.8" y="6.6" width="4.6" height="10.8" rx="1.7" /><path strokeWidth="2" opacity=".4" d="M6 9.5h4.5M6 14.5h3" /></>);
export const Settings = icon('Settings', <path {...solid} fillRule="evenodd" d="M9.32 4.89L10.01 2.20A1.2 1.2 0 0 1 13.99 2.20L14.68 4.89L15.14 5.08L17.53 3.67A1.2 1.2 0 0 1 20.33 6.47L18.92 8.86L19.11 9.32L21.80 10.01A1.2 1.2 0 0 1 21.80 13.99L19.11 14.68L18.92 15.14L20.33 17.53A1.2 1.2 0 0 1 17.53 20.33L15.14 18.92L14.68 19.11L13.99 21.80A1.2 1.2 0 0 1 10.01 21.80L9.32 19.11L8.86 18.92L6.47 20.33A1.2 1.2 0 0 1 3.67 17.53L5.08 15.14L4.89 14.68L2.20 13.99A1.2 1.2 0 0 1 2.20 10.01L4.89 9.32L5.08 8.86L3.67 6.47A1.2 1.2 0 0 1 6.47 3.67L8.86 5.08ZM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0z" />);
export const FolderOpen = icon('FolderOpen', <><path {...soft} d="M2.5 16.5V6.5a3 3 0 0 1 3-3h2.9c.8 0 1.6.4 2.1 1l1 1.2h6a3 3 0 0 1 3 3v.6H7.3a3.5 3.5 0 0 0-3.3 2.3z" /><path {...solid} d="M7.6 11h13.6c.9 0 1.5.8 1.3 1.7l-1.8 6.6a3 3 0 0 1-2.9 2.2H3.9c-.9 0-1.5-.8-1.3-1.7l2.1-6.6A3 3 0 0 1 7.6 11z" /></>);
export const Download = icon('Download', <><path strokeWidth="2.6" d="M12 3v10" /><path {...solid} d="M12 17.2c-.4 0-.7-.2-1-.4l-4.3-4.6c-.7-.8-.1-2 .9-2h8.8c1 0 1.6 1.2.9 2L13 16.8c-.3.2-.6.4-1 .4z" /><rect {...soft} x="3" y="18.5" width="18" height="3.5" rx="1.75" /></>);
export const Upload = icon('Upload', <><path strokeWidth="2.6" d="M12 16V6.5" /><path {...solid} d="M12 2.3c.4 0 .7.2 1 .4l4.3 4.6c.7.8.1 2-.9 2H7.6c-1 0-1.6-1.2-.9-2L11 2.7c.3-.2.6-.4 1-.4z" /><rect {...soft} x="3" y="18.5" width="18" height="3.5" rx="1.75" /></>);
export const Archive = icon('Archive', <><rect {...solid} x="2" y="3" width="20" height="6" rx="2.2" /><path {...soft} fillRule="evenodd" d="M3.8 10.5h16.4v7.5a3 3 0 0 1-3 3H6.8a3 3 0 0 1-3-3zM9.5 13.3a1.2 1.2 0 0 0 0 2.4h5a1.2 1.2 0 0 0 0-2.4z" /></>);
export const Bookmark = icon('Bookmark', <path {...solid} d="M7 2.5h10a2.5 2.5 0 0 1 2.5 2.5v15.3c0 1-1.1 1.6-1.9 1L12 17.2l-5.6 4.1c-.8.6-1.9 0-1.9-1V5A2.5 2.5 0 0 1 7 2.5z" />);
export const Library = icon('Library', <><rect {...solid} x="3" y="3.5" width="4.2" height="17" rx="1.6" /><rect {...soft} x="8.6" y="3.5" width="4.2" height="17" rx="1.6" /><rect {...solid} x="14.4" y="4.2" width="4.2" height="16.5" rx="1.6" transform="rotate(-14 16.5 12.5)" /></>);
export const Layers = icon('Layers', <><path {...soft} d="M3.4 15.6l7.7 4.2c.6.3 1.3.3 1.8 0l7.7-4.2c.9-.5.9-1.6 0-2.1l-1.7-.9-6 3.3c-.6.3-1.3.3-1.8 0l-6-3.3-1.7.9c-.9.5-.9 1.6 0 2.1z" /><path {...solid} d="M11.1 3.2c.6-.3 1.3-.3 1.8 0l7.7 4.2c.9.5.9 1.7 0 2.2l-7.7 4.2c-.6.3-1.3.3-1.8 0L3.4 9.6c-.9-.5-.9-1.7 0-2.2z" /></>);
export const Code = icon('Code', <><path strokeWidth="2.7" d="M8.5 7 3.5 12l5 5" /><path strokeWidth="2.7" d="M15.5 7l5 5-5 5" /><path strokeWidth="2.4" opacity=".45" d="M13.3 4.5l-2.6 15" /></>);
export const FlaskConical = icon('FlaskConical', <><path strokeWidth="2.2" d="M9.6 3.2v5.9L4.3 18.3c-.9 1.5.2 3.2 1.9 3.2h11.6c1.7 0 2.8-1.7 1.9-3.2l-5.3-9.2V3.2M8 3h8" /><path {...solid} d="M7.8 14.6h8.4l1.9 3.3c.3.5-.1 1.1-.7 1.1H6.6c-.6 0-1-.6-.7-1.1z" /><circle {...solid} cx="11" cy="11.6" r="1.1" /><circle {...soft} cx="13.4" cy="9.4" r=".9" /></>);
export const Globe = icon('Globe', <><path {...soft} d="M12 2.5a9.5 9.5 0 0 0 0 19c-2.4-2.3-3.9-5.8-3.9-9.5S9.6 4.8 12 2.5z" /><circle strokeWidth="2.2" cx="12" cy="12" r="9.5" /><path strokeWidth="2" d="M12 2.5c2.4 2.3 3.9 5.8 3.9 9.5s-1.5 7.2-3.9 9.5M4.4 7.6c4.8 2.2 10.4 2.2 15.2 0M2.7 13.6c5.8 2.8 12.8 2.8 18.6 0" /></>);
export const ExternalLink = icon('ExternalLink', <><path {...soft} d="M7 4.5h3.5v2.6H7A1.9 1.9 0 0 0 5.1 9v8A1.9 1.9 0 0 0 7 18.9h8a1.9 1.9 0 0 0 1.9-1.9v-3.5h2.6V17a4.5 4.5 0 0 1-4.5 4.5H7A4.5 4.5 0 0 1 2.5 17V9A4.5 4.5 0 0 1 7 4.5z" /><path strokeWidth="2.6" d="M20 4l-8 8" /><path {...solid} d="M21.5 3.6v6.1c0 .9-1.1 1.3-1.7.7l-6.1-6.1c-.6-.6-.2-1.7.7-1.7h6.1c.6 0 1 .4 1 1z" /></>);
export const Cloud = icon('Cloud', <path {...solid} d="M7 19.5a5 5 0 0 1-.6-10A6.5 6.5 0 0 1 18.8 8.4a5.5 5.5 0 0 1-1.3 11.1z" />);
export const LogIn = icon('LogIn', <><path {...soft} d="M13.5 3h3.5a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-3.5z" /><path strokeWidth="2.6" d="M3 12h9" /><path {...solid} d="M16.6 12c0 .4-.2.7-.5.9l-4.3 3.6c-.7.6-1.8.1-1.8-.8V8.3c0-.9 1.1-1.4 1.8-.8l4.3 3.6c.3.2.5.5.5.9z" /></>);
export const LogOut = icon('LogOut', <><path {...soft} d="M10.5 3H7a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h3.5z" /><path strokeWidth="2.6" d="M9.5 12h8.5" /><path {...solid} d="M22.1 12c0 .4-.2.7-.5.9l-4.3 3.6c-.7.6-1.8.1-1.8-.8V8.3c0-.9 1.1-1.4 1.8-.8l4.3 3.6c.3.2.5.5.5.9z" /></>);

// Chat and notes
export const AtSign = icon('AtSign', <><path {...solid} fillRule="evenodd" d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0zM10.4 12a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0z" /><path strokeWidth="2.4" d="M16 9v4.3c0 1.5 1 2.5 2.4 2.5 1.8 0 2.9-1.7 2.9-3.8a9.3 9.3 0 1 0-3.7 7.4" /></>);
export const Paperclip = icon('Paperclip', <path strokeWidth="2.4" d="M15.3 8.2 9.6 13.9a1.6 1.6 0 0 0 2.3 2.3l6.6-6.6a3.6 3.6 0 0 0-5.1-5.1l-6.9 6.9a5.6 5.6 0 0 0 7.9 7.9l5.4-5.4" />);
export const MessageSquarePlus = icon('MessageSquarePlus', <path {...solid} fillRule="evenodd" d="M6 3.5h12A3.5 3.5 0 0 1 21.5 7v7a3.5 3.5 0 0 1-3.5 3.5h-5.2l-4.4 3.4c-.7.5-1.6 0-1.6-.8v-2.6H6A3.5 3.5 0 0 1 2.5 14V7A3.5 3.5 0 0 1 6 3.5zM10.8 7.3v2.5H8.3a1.2 1.2 0 0 0 0 2.4h2.5v2.5a1.2 1.2 0 0 0 2.4 0v-2.5h2.5a1.2 1.2 0 0 0 0-2.4h-2.5V7.3a1.2 1.2 0 0 0-2.4 0z" />);
export const StickyNote = icon('StickyNote', <><path {...soft} d="M5.5 3h13A2.5 2.5 0 0 1 21 5.5V14l-7 7H5.5A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3z" /><path {...solid} d="M14 21v-4.5a2.5 2.5 0 0 1 2.5-2.5H21z" /><path strokeWidth="2.2" d="M7 8h10M7 12h5.5" /></>);
export const ListChecks = icon('ListChecks', <><path strokeWidth="2.4" d="M3.5 7.2l2 2 3.6-4.2M3.5 16.7l2 2 3.6-4.2" /><rect {...soft} x="12" y="5.5" width="9.5" height="3.2" rx="1.6" /><rect {...soft} x="12" y="15" width="9.5" height="3.2" rx="1.6" /></>);
export const Brain = icon('Brain', <><path {...solid} fillRule="evenodd" d="M11 4.6a3.2 3.2 0 0 0-5.3 1.2A3.4 3.4 0 0 0 3.3 10a3.5 3.5 0 0 0 .5 4.8 3.4 3.4 0 0 0 3.5 4.7A3.1 3.1 0 0 0 11 20zM6.2 9.4c1.9-.9 3.6-.2 4 1.7-1.3-.9-2.5-1.2-4-1.7zM5.6 15.6c1.5.1 2.8-.8 3.2-2.4-1.1.9-2 1.6-3.2 2.4z" /><path {...soft} d="M13 4.6a3.2 3.2 0 0 1 5.3 1.2 3.4 3.4 0 0 1 2.4 4.2 3.5 3.5 0 0 1-.5 4.8 3.4 3.4 0 0 1-3.5 4.7A3.1 3.1 0 0 1 13 20z" /></>);
export const Eye = icon('Eye', <><path {...soft} d="M12 5c5 0 8.6 4 9.9 6.2.3.5.3 1.1 0 1.6C20.6 15 17 19 12 19S3.4 15 2.1 12.8c-.3-.5-.3-1.1 0-1.6C3.4 9 7 5 12 5z" /><path {...solid} fillRule="evenodd" d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0zM12.3 10.6a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0z" /></>);
export const Dices = icon('Dices', <><rect {...soft} x="2.6" y="3.4" width="8.6" height="8.6" rx="2.2" transform="rotate(-14 6.9 7.7)" /><path {...solid} fillRule="evenodd" d="M12 9.5h7a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 9.5 19v-7A2.5 2.5 0 0 1 12 9.5zM12.1 13a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0zM16.5 18a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0zM14.3 15.5a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0z" /></>);

// Status
export const CircleAlert = icon('CircleAlert', <><circle {...soft} cx="12" cy="12" r="10" /><path strokeWidth="2.6" d="M12 7v6" /><circle {...solid} cx="12" cy="16.8" r="1.5" /></>);
export const TriangleAlert = icon('TriangleAlert', <><path {...soft} d="M10.3 3.4c.8-1.3 2.6-1.3 3.4 0l8.1 14.1c.8 1.3-.2 3-1.7 3H3.9c-1.5 0-2.5-1.7-1.7-3z" /><path strokeWidth="2.6" d="M12 8.8v4.6" /><circle {...solid} cx="12" cy="17" r="1.5" /></>);
export const CircleQuestionMark = icon('CircleQuestionMark', <><circle {...soft} cx="12" cy="12" r="10" /><path strokeWidth="2.4" d="M9.3 9.4a2.8 2.8 0 0 1 5.4 1c0 1.8-2.7 2.2-2.7 3.8" /><circle {...solid} cx="12" cy="17.5" r="1.5" /></>);
export const LoaderCircle = icon('LoaderCircle', <><circle strokeWidth="2.8" opacity=".3" cx="12" cy="12" r="8.5" /><path strokeWidth="2.8" d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" /></>);
export const Power = icon('Power', <><path strokeWidth="2.6" opacity=".45" d="M7 6.6a8 8 0 1 0 10 0" /><rect {...solid} x="10.6" y="2" width="2.8" height="10" rx="1.4" /></>);
export const Wrench = icon('Wrench', <><g transform="rotate(45 12 12)"><path {...solid} d="M10.4 3.3v3.4a1 1 0 0 0 1 1h1.2a1 1 0 0 0 1-1V3.3A4.6 4.6 0 0 1 13.9 12v8.5a1.9 1.9 0 0 1-3.8 0V12A4.6 4.6 0 0 1 10.4 3.3z" /></g></>);

/** Every icon by name, for the contact sheet and tests. */
export const ALL_ICONS = {
  Archive, ArrowLeftRight, ArrowUp, AtSign, AudioLines, Bookmark, Brain, Check, ChevronDown, ChevronUp, CircleAlert, CircleQuestionMark, CircleStop,
  ClipboardPaste, Cloud, Code, Copy, CopyPlus, Dices, Download, Drum, Ear, Ellipsis, ExternalLink, Eye, FlaskConical, FolderOpen, Gauge, Globe, Layers,
  Library, ListChecks, LoaderCircle, LogIn, LogOut, MessageSquarePlus, Metronome, Mic, MousePointer2, Music, PanelLeft, PanelRight, Paperclip, Pause,
  Pencil, Piano, Play, Plus, Power, Redo2, Repeat, RotateCcw, Scissors, Search, Settings, Shuffle, SkipBack, SlidersHorizontal, Square, StickyNote,
  Trash, TriangleAlert, Undo2, Upload, Wrench, X, ZoomIn, ZoomOut,
};
