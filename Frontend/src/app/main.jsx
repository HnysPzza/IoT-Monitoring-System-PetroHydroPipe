import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../shared/services/queryClient.js'
import App from './App.jsx'
import { AuthProvider } from '../features/auth/authSession.jsx'
import { ThemeProvider } from '../shared/context/ThemeContext.jsx'
import '../shared/styles/tokens.css'

const QueryDevtools = import.meta.env.DEV
  ? lazy(() => import('@tanstack/react-query-devtools').then((module) => ({ default: module.ReactQueryDevtools })))
  : null

createRoot(document.getElementById('root')).render(
  <>
    {/* BrowserRouter handles URL routes; providers share theme and login state across every page. */}
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
      {QueryDevtools ? <Suspense fallback={null}><QueryDevtools initialIsOpen={false} /></Suspense> : null}
    </QueryClientProvider>
  </>,
)
