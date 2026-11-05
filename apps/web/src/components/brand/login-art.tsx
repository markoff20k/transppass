import { TransppassMark } from '@/components/brand/transppass-logo';
import { BusLineup } from '@/components/bus/bus-lineup';

interface LoginArtProps {
  kicker?: string;
  headline?: string;
  copy?: string;
}

/**
 * A metade da marca nas telas fora do shell (login, primeiro acesso): a fila
 * de carros da Transppass no pátio ao entardecer, o da frente chegando e
 * dando farol alto, e o símbolo como marca d'água. No celular vira uma faixa
 * curta no topo (ver .login__art em styles.css).
 */
export function LoginArt({
  kicker = 'Transppass · Módulo PCM',
  headline = 'A garagem inteira, numa tela.',
  copy = 'Do evento na rua à liberação do carro: cada decisão vira registro, e o MKBF sai do próprio processo — ninguém digita.',
}: LoginArtProps) {
  return (
    <aside className="login__art" aria-hidden>
      <TransppassMark size={420} className="login__watermark" />
      <div className="login__art-copy">
        <span className="login__kicker">{kicker}</span>
        <h2 className="login__headline">{headline}</h2>
        <p>{copy}</p>
      </div>
      <div className="login__road">
        <BusLineup className="login__bus" />
      </div>
    </aside>
  );
}
