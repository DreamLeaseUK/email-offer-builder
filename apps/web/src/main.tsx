// First: catch the browser's install offer, which can arrive before the app has drawn anything (install.ts).
import './install';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'dreamlease-design-system/styles/dreamlease.css';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
