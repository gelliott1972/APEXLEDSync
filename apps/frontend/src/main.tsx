import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Amplify } from 'aws-amplify';
import App from './App';
import { queryClient } from './lib/query-client';
import { useAuthStore } from './stores/auth-store';
import './lib/i18n';
import './index.css';

// Configure Amplify (will be loaded from config.json in production)
const configureAmplify = async () => {
  try {
    const response = await fetch('/config.json');
    const config = await response.json();

    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: config.userPoolId,
          userPoolClientId: config.userPoolClientId,
          loginWith: {
            email: true,
          },
        },
      },
    });
  } catch {
    // Local development fallback
    const userPoolId = import.meta.env.VITE_USER_POOL_ID ?? 'local-user-pool';
    const userPoolClientId = import.meta.env.VITE_USER_POOL_CLIENT_ID ?? 'local-client-id';
    console.log('Using development configuration:', { userPoolId, userPoolClientId });
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId,
          userPoolClientId,
          loginWith: {
            email: true,
          },
        },
      },
    });
  }
};

configureAmplify().then(() => {
  // Check auth status after Amplify is configured
  useAuthStore.getState().checkAuth();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>
  );
});
