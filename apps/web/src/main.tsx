import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { Theme } from '@radix-ui/themes'
import { Toaster } from 'sonner'
import App from './app/App'
import '@radix-ui/themes/styles.css'
import './app/styles/toast.css'
// i18n bootstrap (side-effect import). Initializes i18next + sets the
// active language from localStorage / browser before App renders, so
// useTranslation() returns the right strings on first paint.
import './i18n'

// 桌面端 (Electron) 通过 file:// 加载 index.html, pathname 是磁盘上的绝对
// 路径, BrowserRouter 没法 match 任何业务路由 → 整页不渲染 (黑屏).
// 用 HashRouter, 把路由放进 #fragment, 与 pathname 解耦.
// 浏览器 / docker 自部署仍然走 BrowserRouter 保留正常 URL.
const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:'
const Router = isFileProtocol ? HashRouter : BrowserRouter
// BrowserRouter 走 basename, HashRouter 不需要 (fragment 之前的路径它不看).
const routerProps = isFileProtocol ? {} : { basename: '/' }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router {...routerProps}>
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
    </Router>
  </StrictMode>,
)
