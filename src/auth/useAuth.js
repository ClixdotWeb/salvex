import { createContext, useContext } from 'react';

// The context object and the hook live apart from the provider component (AuthContext.jsx).
export const AuthContext = createContext(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
