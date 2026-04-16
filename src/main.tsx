import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AzureAuthProvider } from './auth/azureAuth.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AzureAuthProvider>
      <App />
    </AzureAuthProvider>
  </StrictMode>,
)
