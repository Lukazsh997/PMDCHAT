export { AuthModule } from './auth.module.js';
export { PasswordService } from './password.service.js';
export { SessionService } from './session.service.js';
export type { ActiveSession, AuthContext } from './auth.types.js';
export { authenticate } from './auth.guard.js';
export { MfaService } from './mfa.service.js';
export {
  EXTERNAL_AUTH,
  type ExternalAuthenticator,
  ExternalAuthUnavailableError,
} from './external-auth.js';
