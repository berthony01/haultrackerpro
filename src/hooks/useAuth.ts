// Compatibility shim — kept so any stale dev/HMR module URL referencing
// `src/hooks/useAuth.ts` still resolves after the file was renamed to
// `useAuth.tsx`. All real implementation lives in `./useAuth.tsx`.
export { AuthProvider, useAuth } from './useAuth.tsx';
