import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import Atelier from './atelier/Atelier.jsx'

// The original API dashboard stays available at /#/dashboard.
const Dashboard = lazy(() => import('./App.jsx'))
const isDashboard = window.location.hash.startsWith('#/dashboard')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isDashboard ? (
      <Suspense fallback={null}>
        <Dashboard />
      </Suspense>
    ) : (
      <Atelier />
    )}
  </StrictMode>,
)
