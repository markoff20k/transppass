import { createContext, useContext, useEffect, type ReactNode } from 'react';

/**
 * Subheader controlado pela página.
 *
 * Cada tela declara título, descrição e ações uma vez com `usePageHeader`, e o
 * shell renderiza no lugar certo. Assim o subheader é um só para o sistema
 * inteiro, e nenhuma tela precisa saber como ele é desenhado.
 */
export interface PageHeaderSpec {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Trilha do breadcrumb: rótulos e rotas dos pais. */
  crumbs?: { label: string; to?: string }[];
}

export interface PageHeaderContextValue {
  spec: PageHeaderSpec | null;
  setSpec: (spec: PageHeaderSpec | null) => void;
}

export const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

export function usePageHeader(spec: PageHeaderSpec): void {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error('usePageHeader precisa estar dentro do AppShell');

  const { setSpec } = ctx;
  const { eyebrow, title, description, actions, crumbs } = spec;
  const crumbsKey = JSON.stringify(crumbs ?? []);

  useEffect(() => {
    setSpec({ eyebrow, title, description, actions, crumbs });
    return () => setSpec(null);
    // `actions` é ReactNode e muda de identidade a cada render; comparar por
    // título/descrição evita re-render em cascata sem perder atualização real.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSpec, eyebrow, title, description, crumbsKey]);
}

export function usePageHeaderSpec(): PageHeaderSpec | null {
  const ctx = useContext(PageHeaderContext);
  return ctx?.spec ?? null;
}
