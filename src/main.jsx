import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'

// Each experience is its own chunk, so one page's global styles never load
// on another. The original API dashboard stays available at /#/dashboard;
// The Legacy Protocol lives at /#/legacy.
const routes = {
  dashboard: lazy(() => import('./App.jsx')),
  legacy: lazy(() => import('./legacy/Legacy.jsx')),
  atelier: lazy(() => import('./atelier/Atelier.jsx')),
}
const route = () => {
  const h = window.location.hash
  if (h.startsWith('#/dashboard')) return 'dashboard'
  if (h.startsWith('#/legacy')) return 'legacy'
  return 'atelier'
}
const current = route()
const Page = routes[current]

// Switching between experiences reloads, so each starts from a clean slate.
window.addEventListener('hashchange', () => {
  if (route() !== current) window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  </StrictMode>,
)
