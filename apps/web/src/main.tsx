import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Theme } from '@radix-ui/themes'
import { Toaster } from 'sonner'
import App from './app/App'
import '@radix-ui/themes/styles.css'
import './app/styles/toast.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Theme appearance="dark" accentColor="blue" grayColor="slate" radius="medium">
        {/*
         * richColors is intentionally OFF: we want to drive toast colors from
         * Radix alpha scales (see app/styles/toast.css) so the three semantic
         * toast types stay translucent on the dark canvas instead of the
         * default candy-red sonner palette.
         */}
        <Toaster position="top-center" theme="dark" closeButton duration={4000} />
        <App />
      </Theme>
    </BrowserRouter>
  </StrictMode>,
)
