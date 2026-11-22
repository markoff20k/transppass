import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { IaStatus } from '@app/shared';
import { api } from '@/lib/api-client';
import { useUiPref } from '@/features/auth/use-ui-pref';

interface IaContextValue {
  status: IaStatus | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
}

const IaContext = createContext<IaContextValue | null>(null);

/**
 * Estado do painel da ia.Transppass: aberto ou fechado e a conversa atual,
 * guardados na conta (voltam iguais depois de refresh ou em outra máquina).
 * O status (provedor e modelo) vem da API e muda só com reinício dela.
 */
export function IaProvider({ children }: { children: ReactNode }) {
  const [open, setOpenPref] = useUiPref<boolean>('ia.open', false);
  const [conversationId, setConversationPref] = useUiPref<string | null>('ia.conversation', null);
  const status = useQuery({
    queryKey: ['ia', 'status'],
    queryFn: () => api.get<IaStatus>('/ia/status'),
    staleTime: 5 * 60_000,
  });
  const setOpen = useCallback((v: boolean) => setOpenPref(v), [setOpenPref]);
  const toggle = useCallback(() => setOpenPref((v) => !v), [setOpenPref]);
  const setConversationId = useCallback((id: string | null) => setConversationPref(id), [setConversationPref]);
  const value = useMemo<IaContextValue>(
    () => ({ status: status.data ?? null, open, setOpen, toggle, conversationId, setConversationId }),
    [status.data, open, setOpen, toggle, conversationId, setConversationId],
  );
  return <IaContext.Provider value={value}>{children}</IaContext.Provider>;
}

export function useIa(): IaContextValue {
  const ctx = useContext(IaContext);
  if (!ctx) throw new Error('useIa fora do IaProvider');
  return ctx;
}
