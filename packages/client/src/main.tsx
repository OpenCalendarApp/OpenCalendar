import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App.js';
import { AuthProvider } from './context/AuthContext.js';
import { TimezoneProvider } from './context/TimezoneContext.js';
import { ToastProvider } from './context/ToastContext.js';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true
      }}
    >
      <ToastProvider>
        <TimezoneProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </TimezoneProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
