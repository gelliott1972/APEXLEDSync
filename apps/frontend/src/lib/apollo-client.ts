import {
  ApolloClient,
  InMemoryCache,
  ApolloLink,
  HttpLink,
  split,
} from '@apollo/client';
import { getMainDefinition } from '@apollo/client/utilities';
import { createAuthLink } from 'aws-appsync-auth-link';
import { createSubscriptionHandshakeLink } from 'aws-appsync-subscription-link';
import { fetchAuthSession } from 'aws-amplify/auth';

// AppSync configuration - these will be set from environment variables
const GRAPHQL_URL = import.meta.env.VITE_GRAPHQL_URL ?? '';
const AWS_REGION = import.meta.env.VITE_AWS_REGION ?? 'ap-east-1';

// Auth configuration for AppSync
const auth = {
  type: 'AMAZON_COGNITO_USER_POOLS' as const,
  jwtToken: async () => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.idToken?.toString() ?? '';
    } catch {
      return '';
    }
  },
};

// Create the Apollo client only if GraphQL URL is configured
export function createApolloClient() {
  if (!GRAPHQL_URL) {
    console.warn('GraphQL URL not configured, Apollo client disabled');
    return null;
  }

  const url = GRAPHQL_URL;
  const region = AWS_REGION;

  // HTTP link for queries and mutations
  const httpLink = new HttpLink({ uri: url });

  // Auth link for adding Cognito JWT token
  const authLink = createAuthLink({ url, region, auth });

  // Subscription link for WebSocket connections
  const subscriptionLink = createSubscriptionHandshakeLink({ url, region, auth });

  // Split traffic between subscriptions (WebSocket) and queries/mutations (HTTP)
  const link = split(
    ({ query }) => {
      const definition = getMainDefinition(query);
      return (
        definition.kind === 'OperationDefinition' &&
        definition.operation === 'subscription'
      );
    },
    subscriptionLink,
    ApolloLink.from([authLink, httpLink])
  );

  // Create cache with type policies for proper normalization
  const cache = new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          listShowSets: {
            merge(_existing = [], incoming: unknown[]) {
              return incoming;
            },
          },
          listSessions: {
            merge(_existing = [], incoming: unknown[]) {
              return incoming;
            },
          },
        },
      },
      ShowSet: {
        keyFields: ['showSetId'],
      },
      Session: {
        keyFields: ['userId'],
      },
    },
  });

  return new ApolloClient({
    link,
    cache,
    defaultOptions: {
      watchQuery: {
        fetchPolicy: 'cache-and-network',
      },
      query: {
        fetchPolicy: 'cache-first',
      },
    },
  });
}

// Singleton instance
let apolloClient: ApolloClient<unknown> | null = null;

export function getApolloClient() {
  if (!apolloClient) {
    apolloClient = createApolloClient();
  }
  return apolloClient;
}
