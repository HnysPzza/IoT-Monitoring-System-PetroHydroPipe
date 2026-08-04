import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App.jsx'
import { AuthProvider } from '../features/auth/authSession.jsx'
import { ThemeProvider } from '../shared/context/ThemeContext.jsx'
import '../shared/styles/tokens.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* BrowserRouter handles URL routes; providers share theme and login state across every page. */}
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
