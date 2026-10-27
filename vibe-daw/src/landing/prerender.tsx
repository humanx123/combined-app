import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { Landing } from './Landing';

/** The landing page as static HTML, so crawlers and link previews see it without running JS. */
export const render = () => renderToString(<StrictMode><Landing /></StrictMode>);
