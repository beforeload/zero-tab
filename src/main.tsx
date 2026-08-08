import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../extension/builder-digest.js';
import '../extension/style.css';
import './workstation.css';

const root = document.getElementById('root');
if (!root) throw new Error('Zero Tab root element is missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
