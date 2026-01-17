import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      refetchInterval: 1000 * 60, // 60 second polling
      refetchOnWindowFocus: true,
      retry: 3,
    },
    mutations: {
      retry: 1,
    },
  },
});
