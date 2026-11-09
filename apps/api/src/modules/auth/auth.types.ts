import type { SessionDevice } from '@plataforma/contracts';
import type { OrgUnitRow, UserRow } from '../../database/schema/index.js';

/** Sessão ativa, como guardada no Valkey. */
export interface ActiveSession {
  id: string;
  userId: string;
  tokenHash: string;
  deviceType: SessionDevice;
  createdAt: string;
  expiresAt: string;
  touchedAt: string;
  dbTouchedAt: string;
}

export interface AuthContext {
  user: UserRow;
  orgUnit: OrgUnitRow | null;
  mfaEnabled: boolean;
  session: ActiveSession;
}
