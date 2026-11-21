import { useIsFetching } from '@tanstack/react-query';
import { useDelayedFlag } from '@/lib/use-delayed-flag';

/**
 * Linha de progresso no alto da área de conteúdo, logo abaixo do cabeçalho,
 * enquanto alguma consulta busca um dado que a tela ainda não tem: primeira
 * carga, troca de filtro, de página ou de período. Vale para o sistema
 * inteiro, sem cada página precisar se preocupar.
 *
 * Conta só consultas em estado `pending` (sem dado próprio ainda) e com alguém
 * na tela esperando por elas. O refetch periódico das páginas que fazem
 * polling tem dado, então não acende a linha — senão ela piscaria a cada 30 s
 * no Dashboard e em Eventos; a pré-busca dos períodos vizinhos não tem
 * observador, então corre em silêncio.
 *
 * Mesma regra do véu: só aparece depois de 200 ms e fica ao menos 500 ms.
 */
export function FetchBar() {
  const pending = useIsFetching({ predicate: (q) => q.state.status === 'pending' && q.getObserversCount() > 0 });
  const shown = useDelayedFlag(pending > 0, 200, 500);
  return <div className={`fetch-bar${shown ? ' is-active' : ''}`} aria-hidden />;
}
