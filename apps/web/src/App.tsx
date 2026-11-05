import { Navigate, Route, Routes } from 'react-router';
import { Toaster } from './components/ui';
import { AccountPage } from './features/account/AccountPage';
import { AdminLayout } from './features/admin/AdminLayout';
import { AuditPage } from './features/admin/AuditPage';
import { LdapPage } from './features/admin/LdapPage';
import { OrgPage } from './features/admin/OrgPage';
import { OverviewPage } from './features/admin/OverviewPage';
import { RolesPage } from './features/admin/RolesPage';
import { UsersPage } from './features/admin/UsersPage';
import { LoginPage } from './features/auth/LoginPage';
import { RequireAuth } from './features/auth/RequireAuth';
import { ChatPage } from './features/chat/ChatPage';
import { OrgDirectoryPage } from './features/org/OrgDirectoryPage';
import { SearchPage } from './features/search/SearchPage';
import { AppShell } from './features/shell/AppShell';

export function App() {
  return (
    <>
      <Routes>
        <Route path="/entrar" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<ChatPage />} />
          <Route path="c/:conversationId" element={<ChatPage />} />
          <Route path="organograma" element={<OrgDirectoryPage />} />
          <Route path="busca" element={<SearchPage />} />
          <Route
            path="conta"
            element={
              <div className="h-full overflow-y-auto">
                <AccountPage />
              </div>
            }
          />
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="usuarios" element={<UsersPage />} />
            <Route path="organograma" element={<OrgPage />} />
            <Route path="papeis" element={<RolesPage />} />
            <Route path="auditoria" element={<AuditPage />} />
            <Route path="active-directory" element={<LdapPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </>
  );
}
