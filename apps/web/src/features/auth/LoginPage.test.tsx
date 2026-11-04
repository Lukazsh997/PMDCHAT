import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

function renderLogin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init))),
  );
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('LoginPage', () => {
  it('valida os campos antes de chamar a API', async () => {
    mockFetch(() => json(401, { statusCode: 401, code: 'UNAUTHENTICATED', message: 'x' }));
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Informe a senha')).toBeInTheDocument();
    expect(screen.getByLabelText('Usuário')).toHaveAttribute('aria-invalid', 'true');
  });

  it('mostra a mensagem da API quando as credenciais estão erradas', async () => {
    mockFetch((url) =>
      url.endsWith('/auth/me')
        ? json(401, { statusCode: 401, code: 'UNAUTHENTICATED', message: 'x' })
        : json(401, {
            statusCode: 401,
            code: 'INVALID_CREDENTIALS',
            message: 'Usuário ou senha incorretos.',
          }),
    );
    renderLogin();
    await userEvent.type(screen.getByLabelText('Usuário'), 'maria.silva');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Usuário ou senha incorretos.'),
    );
  });
});
