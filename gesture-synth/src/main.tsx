import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { mountStudioButton } from './bridge';

createRoot(document.getElementById('app-root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

mountStudioButton();
