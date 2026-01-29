import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ApolloProvider } from '@apollo/client';
import { Amplify } from 'aws-amplify';
import App from './App';
import { queryClient } from './lib/query-client';
import { getApolloClient } from './lib/apollo-client';
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

  // Get Apollo client (may be null if GraphQL URL not configured)
  const apolloClient = getApolloClient();

  // Wrapper component that conditionally provides Apollo
  const AppWithProviders = () => {
    const app = (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    );

    // If Apollo client is available, wrap with ApolloProvider
    if (apolloClient) {
      return <ApolloProvider client={apolloClient}>{app}</ApolloProvider>;
    }

    return app;
  };

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppWithProviders />
    </React.StrictMode>
  );
});
