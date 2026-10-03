import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Inter is the page's typeface (venturemaker.org's). Sora stays for the game
// tables: the card frames were drawn around it.
import '@fontsource-variable/inter/wght.css';
import '@fontsource/sora/700.css';
import '@fontsource/sora/800.css';
import './styles.css';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { ToastProvider } from './components/ui.jsx';

// A referral code in the URL is remembered until an account is created.
try {
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (ref) localStorage.setItem('va.ref', ref.toUpperCase().slice(0, 12));
} catch { /* private mode */ }

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
