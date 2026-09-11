import { createContext } from 'react';
import type { LoginInput, PublicUser } from '@app/shared';

export interface AuthContextValue {
  user: PublicUser | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Atualiza o usuário em memória depois de editar o perfil. */
  updateUser: (user: PublicUser) => void;
}

/**
 * O contexto mora separado do provider para que o arquivo do provider exporte
 * só componentes — condição do fast refresh do Vite.
 */
export const AuthContext = createContext<AuthContextValue | null>(null);
