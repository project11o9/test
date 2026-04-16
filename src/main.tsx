import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';

const App = lazy(() => import('./App.tsx'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div style={{padding: '2rem', fontFamily: 'sans-serif'}}>Loading admin app…</div>}>
      <App />
    </Suspense>
  </StrictMode>,
);
