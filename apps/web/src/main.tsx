import './styles.css';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { meKey } from './features/auth/auth-api';
import { ApiRequestError } from './lib/api';

const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true } },
  // Sessão expirada em qualquer chamada: volta para a tela de login.
  mutationCache: new MutationCache({
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === 'UNAUTHENTICATED') {
        queryClient.setQueryData(meKey, null);
      }
    },
  }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
