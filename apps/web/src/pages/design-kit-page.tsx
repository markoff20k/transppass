import { BRAND } from '@app/design-kit';
import { DOWNTIME_CAUSE_LABELS, DowntimeCause, VEHICLE_STATUS_LABELS, VehicleStatus } from '@app/shared';
import { usePageHeader } from '@/components/shell/page-header.context';
import { BusIllustration } from '@/components/bus/bus-illustration';
import { TransppassLogo, TransppassMark } from '@/components/brand/transppass-logo';

/**
 * Referência viva do design kit.
 *
 * Renderiza os componentes a partir do CSS de verdade, não de cópias. Uma
 * mudança no kit aparece aqui na hora — é o que impede a documentação de virar
 * ficção, que é o destino habitual de style guide mantido à mão.
 *
 * O tema e o contraste se trocam no header, como em qualquer outra tela.
 */
export function DesignKitPage() {
  usePageHeader({
    eyebrow: 'Sistema',
    title: 'Design kit',
    description:
      'As duas cores vieram do logo da Transppass. Tudo aqui é renderizado com o CSS que a aplicação usa.',
  });

  return (
    <>
      {/* ---- Marca ---- */}
      <section className="tp-card">
        <h2>Marca</h2>
        <p className="tp-muted">
          Extraídas do logo, pixel a pixel: o grafite ocupa 2.631 px do arquivo e o laranja 272 px.
          Essa proporção é a regra de uso — o grafite estrutura, o laranja pontua.
        </p>
        <div className="swatch-grid">
          <Swatch name="Grafite" hex={BRAND.graphite} note="Monograma e wordmark · 90,6% da área" />
          <Swatch name="Laranja" hex={BRAND.orange} note="O ponto da figura · 9,4% da área" />
        </div>

        <h3>Logo vetorial</h3>
        <p className="tp-muted">
          Reconstruído da geometria medida no arquivo original. O grafite usa <code>currentColor</code>,
          então o mesmo desenho funciona sobre qualquer fundo. O laranja é fixo.
        </p>
        <div className="logo-specimens">
          <div className="logo-specimen logo-specimen--light">
            <TransppassLogo height={48} />
          </div>
          <div className="logo-specimen logo-specimen--dark">
            <TransppassLogo height={48} />
          </div>
          <div className="logo-specimen logo-specimen--brand">
            <TransppassMark size={44} />
          </div>
        </div>

        <div className="tp-alert tp-alert--warning">
          <strong>A armadilha da marca laranja</strong>
          <p>
            Branco sobre <code>#f87509</code> dá 2,79:1 — reprova em AA, inclusive no botão primário.
            Grafite 950 sobre o mesmo laranja dá 6,45:1. Por isso existem três tokens que parecem o
            mesmo: <code>--color-brand</code> preenche, <code>--color-brand-text</code> escreve, e{' '}
            <code>--color-text-on-brand</code> vai sobre o laranja — nunca branco.
          </p>
        </div>
      </section>

      {/* ---- O ônibus ---- */}
      <section className="tp-card">
        <h2>O ônibus — estado desenhado no veículo</h2>
        <p className="tp-muted">
          Elemento de assinatura do sistema. Em vez de ler "em manutenção" numa etiqueta, o PCM vê um
          ônibus âmbar levantado no macaco com a chave girando. A animação nunca é a única portadora da
          informação: cor e distintivo continuam com <code>prefers-reduced-motion</code>.
        </p>
        <div className="bus-gallery">
          {Object.values(VehicleStatus).map((status) => (
            <div key={status} className="bus-gallery__item">
              <BusIllustration status={status} code="10001" width={220} />
              <span className="tp-muted">{VEHICLE_STATUS_LABELS[status]}</span>
              <code>{status}</code>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Escalas ---- */}
      <section className="tp-card">
        <h2>Escalas</h2>
        <Ramp label="Laranja" prefix="tp-orange" steps={[...SCALE, 950]} anchor={500} />
        <Ramp label="Grafite" prefix="tp-graphite" steps={[...SCALE, 950]} anchor={700} />
        <Ramp label="Verde" prefix="tp-green" steps={SCALE} />
        <Ramp label="Âmbar" prefix="tp-amber" steps={SCALE} />
        <Ramp label="Vermelho" prefix="tp-red" steps={SCALE} />
        <Ramp label="Azul" prefix="tp-blue" steps={SCALE} />
      </section>

      {/* ---- Tokens semânticos ---- */}
      <section className="tp-card">
        <h2>Tokens semânticos</h2>
        <p className="tp-muted">
          Nenhum componente conhece "laranja 500"; ele conhece "cor da ação primária". É esta camada
          inteira que troca entre claro e escuro. Troque o tema no header e veja os quadrados mudarem.
        </p>
        <div className="token-grid">
          {SEMANTIC_TOKENS.map((group) => (
            <div key={group.title}>
              <h3>{group.title}</h3>
              <ul className="token-list">
                {group.tokens.map((t) => (
                  <li key={t}>
                    <span className="token-chip" style={{ background: `var(--${t})` }} />
                    <code>{t}</code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Tipografia ---- */}
      <section className="tp-card">
        <h2>Tipografia</h2>
        <p className="tp-muted">
          Barlow, auto-hospedada no pacote — sem CDN, funciona com a garagem offline. A linhagem da
          Barlow é a sinalização rodoviária. A condensada fica para títulos e o wordmark; a Plex Mono
          para prefixo, código e medição.
        </p>
        <div className="type-list">
          {TYPE_SCALE.map((t) => (
            <div key={t.token}>
              <span style={{ fontSize: `var(--${t.token})`, fontWeight: t.weight, fontFamily: t.family }}>
                {t.sample}
              </span>
              <code className="tp-muted">
                --{t.token} · {t.size} · {t.use}
              </code>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Botões ---- */}
      <section className="tp-card">
        <h2>Botões</h2>
        <p className="tp-muted">
          A ação padrão é grafite. O laranja fica para a ação principal da tela — no máximo uma por
          tela, senão deixa de significar alguma coisa.
        </p>
        <div className="tp-btn-group">
          <button type="button" className="tp-btn">Ação padrão</button>
          <button type="button" className="tp-btn tp-btn--primary">Ação principal</button>
          <button type="button" className="tp-btn tp-btn--secondary">Secundária</button>
          <button type="button" className="tp-btn tp-btn--ghost">Discreta</button>
          <button type="button" className="tp-btn tp-btn--danger">Destrutiva</button>
          <button type="button" className="tp-btn" disabled>Desabilitada</button>
          <button type="button" className="tp-btn tp-btn--sm">Pequena</button>
        </div>

        <h3>Alvos de chão</h3>
        <p className="tp-muted">
          Socorro, sub-OS, inspeção e limpeza. Mínimo de 48px de altura, texto de 16px — a seção 8 do
          PRD exige operação com uma mão e com luva.
        </p>
        <div className="tp-btn-group">
          <button type="button" className="tp-btn tp-btn--touch tp-btn--secondary">Cheguei</button>
          <button type="button" className="tp-btn tp-btn--touch tp-btn--secondary">Comecei</button>
          <button type="button" className="tp-btn tp-btn--touch tp-btn--primary">Terminei</button>
        </div>
      </section>

      {/* ---- Campos ---- */}
      <section className="tp-card">
        <h2>Campos</h2>
        <div className="tp-split">
          <div className="tp-stack">
            <div className="tp-field">
              <label className="tp-label" htmlFor="dk-1">Prefixo do carro</label>
              <input id="dk-1" className="tp-input" placeholder="10001" />
            </div>
            <div className="tp-field">
              <label className="tp-label" htmlFor="dk-2">
                Motivo <span className="tp-label__required">obrigatório</span>
              </label>
              <select id="dk-2" className="tp-select">
                <option>SEG — Risco de segurança</option>
                <option>CONTR — Exigência contratual</option>
              </select>
              <span className="tp-help">Sem motivo, a fila não muda (RF-08).</span>
            </div>
            <div className="tp-field">
              <label className="tp-label" htmlFor="dk-3">Leitura do hodômetro</label>
              <input id="dk-3" className="tp-input tp-input--num" defaultValue="184320" aria-invalid="true" />
              <span className="tp-error">Delta de 5.240 km é inviável para um dia de operação</span>
            </div>
          </div>
          <div className="tp-stack">
            <h3>Escolha</h3>
            <label className="tp-radio-card"><input type="radio" name="dk-dest" defaultChecked /> Socorro em campo</label>
            <label className="tp-radio-card"><input type="radio" name="dk-dest" /> Recolher</label>
            <label className="tp-radio-card"><input type="radio" name="dk-dest" disabled /> Deferir (bloqueado por segurança)</label>
            <h3>Checklist</h3>
            <label className="tp-check"><input type="checkbox" defaultChecked /> Conferir tensão de carga</label>
            <label className="tp-check"><input type="checkbox" /> Testar acionamento</label>
          </div>
        </div>
      </section>

      {/* ---- Estados e etiquetas ---- */}
      <section className="tp-card">
        <h2>Estados do carro</h2>
        <p className="tp-muted">
          Os dez estados do painel se agrupam em quatro leituras operacionais. Dez cores ninguém decora;
          quatro todo mundo entende.
        </p>
        <div className="tp-row">
          <span className="tp-state tp-state--running">Rodando</span>
          <span className="tp-state tp-state--waiting">Esperando</span>
          <span className="tp-state tp-state--working">Em serviço</span>
          <span className="tp-state tp-state--stopped">Parado</span>
        </div>
        <h3>Etiquetas</h3>
        <div className="tp-row">
          <span className="tp-badge">Neutra</span>
          <span className="tp-badge tp-badge--success">Aprovada</span>
          <span className="tp-badge tp-badge--warning">Atenção</span>
          <span className="tp-badge tp-badge--danger">Segurança</span>
          <span className="tp-badge tp-badge--info">Em execução</span>
          <span className="tp-badge tp-badge--brand">Fast-track</span>
        </div>
      </section>

      {/* ---- KPI e composição ---- */}
      <section className="tp-card">
        <h2>Indicadores e decomposição</h2>
        <div className="tp-kpi-row">
          <div className="tp-kpi tp-kpi--brand"><span className="tp-kpi__label">MKBF</span><strong className="tp-kpi__value">8.420 km</strong></div>
          <div className="tp-kpi tp-kpi--good"><span className="tp-kpi__label">Disponibilidade</span><strong className="tp-kpi__value">87,4%</strong></div>
          <div className="tp-kpi tp-kpi--warn"><span className="tp-kpi__label">Km degradado</span><strong className="tp-kpi__value">3</strong><span className="tp-kpi__note">Sem leitura há mais de 2 dias</span></div>
          <div className="tp-kpi tp-kpi--danger"><span className="tp-kpi__label">Prazos vencidos</span><strong className="tp-kpi__value">2</strong></div>
        </div>
        <h3>Decomposição da indisponibilidade (RF-39)</h3>
        <div className="tp-bar">
          {BREAKDOWN.map((b) => (
            <div key={b.cause} className={`tp-bar__seg cause-${b.cause.toLowerCase()}`} style={{ width: `${b.share}%` }} title={`${DOWNTIME_CAUSE_LABELS[b.cause]}: ${b.share}%`} />
          ))}
        </div>
        <ul className="tp-legend">
          {BREAKDOWN.map((b) => (
            <li key={b.cause}><i className={`tp-swatch cause-${b.cause.toLowerCase()}`} />{DOWNTIME_CAUSE_LABELS[b.cause]} — {b.share}%</li>
          ))}
        </ul>
      </section>

      {/* ---- Avisos e portões ---- */}
      <section className="tp-card">
        <h2>Avisos e portões</h2>
        <div className="tp-stack">
          <div className="tp-alert tp-alert--info">Previsão de retorno atualizada para 14:30.</div>
          <div className="tp-alert tp-alert--success">Carro 10001 liberado.</div>
          <div className="tp-alert tp-alert--warning">
            <strong>Falta para liberar:</strong>
            <ul><li>1 sub-OS sem inspeção: S02</li><li>A limpeza ainda não foi concluída</li></ul>
          </div>
          <div className="tp-alert tp-alert--danger">Falha de segurança (PNE-APU-01) não pode ser deferida.</div>
        </div>
        <h3>Portões</h3>
        <ul className="tp-gates">
          <li className="tp-gate tp-gate--open">Todas as sub-OS concluídas (RF-19)</li>
          <li className="tp-gate tp-gate--open">Todas as inspeções aprovadas (RF-20)</li>
          <li className="tp-gate">Limpeza concluída (RF-21)</li>
        </ul>
      </section>

      {/* ---- Tabela ---- */}
      <section className="tp-card">
        <h2>Tabela</h2>
        <div className="tp-table-wrap">
          <table className="tp-table">
            <thead><tr><th>Carro</th><th>Estado</th><th className="is-num">Km atual</th><th>Última leitura</th></tr></thead>
            <tbody>
              <tr><td className="is-strong">10001</td><td><span className="tp-state tp-state--running">Em linha</span></td><td className="is-num">184.320</td><td className="tp-muted">há 1 dia</td></tr>
              <tr className="is-warning"><td className="is-strong">10003</td><td><span className="tp-state tp-state--stopped">Aguardando peça</span></td><td className="is-num">312.045</td><td className="tp-error">há 5 dias</td></tr>
              <tr className="is-danger"><td className="is-strong">10002</td><td><span className="tp-state tp-state--working">Em manutenção</span> <span className="tp-badge tp-badge--danger">segurança</span></td><td className="is-num">241.870</td><td className="tp-muted">há 1 dia</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Regras ---- */}
      <section className="tp-card">
        <h2>O que o kit impõe</h2>
        <ul className="rules">
          <li><strong>Cor nunca é o único sinal.</strong> Toda linha marcada e todo segmento de barra vêm com texto ou etiqueta.</li>
          <li><strong>Alvo de chão tem 48px.</strong> Socorro, sub-OS, inspeção e limpeza são operados com uma mão e com luva.</li>
          <li><strong>Foco sempre visível.</strong> Anel laranja de contorno duplo, que funciona nos dois temas. Nunca remover.</li>
          <li><strong>Números alinham.</strong> <code>tabular-nums</code> em tabela e KPI — ler km em coluna desalinhada é erro real.</li>
          <li><strong>O escuro não é preto.</strong> Preto puro com texto branco vibra e cansa em turno de 8 horas.</li>
          <li><strong>Um laranja por tela.</strong> A ação padrão é grafite; o laranja é a ação principal daquela tela.</li>
          <li><strong>Responsivo é inegociável.</strong> Sidebar vira gaveta abaixo de 1024px; abaixo de 640px, tudo que é ação vira alvo de largura cheia.</li>
        </ul>
      </section>
    </>
  );
}

const SCALE = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

const BREAKDOWN: { cause: DowntimeCause; share: number }[] = [
  { cause: DowntimeCause.QUEUE, share: 34 },
  { cause: DowntimeCause.MATERIAL, share: 26 },
  { cause: DowntimeCause.EXECUTION, share: 22 },
  { cause: DowntimeCause.INSPECTION, share: 9 },
  { cause: DowntimeCause.CLEANING, share: 6 },
  { cause: DowntimeCause.RELEASE_WAIT, share: 3 },
];

const SEMANTIC_TOKENS = [
  { title: 'Superfície', tokens: ['color-bg', 'color-surface', 'color-surface-sunken', 'color-sidebar-bg'] },
  { title: 'Texto', tokens: ['color-text', 'color-text-secondary', 'color-text-muted', 'color-brand-text'] },
  { title: 'Marca e ação', tokens: ['color-brand', 'color-text-on-brand', 'color-action', 'color-focus'] },
  { title: 'Semântico', tokens: ['color-success', 'color-warning', 'color-danger', 'color-info'] },
  { title: 'Estado do carro', tokens: ['color-state-running', 'color-state-waiting', 'color-state-working', 'color-state-stopped'] },
  { title: 'Gráficos', tokens: ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'] },
];

const TYPE_SCALE = [
  { token: 'tp-text-3xl', size: '36px', use: 'número de destaque', weight: 700, family: 'var(--tp-font-display)', sample: '8.420' },
  { token: 'tp-text-2xl', size: '28px', use: 'título de página · display', weight: 600, family: 'var(--tp-font-display)', sample: 'Painel da frota' },
  { token: 'tp-text-xl', size: '22px', use: 'título de seção', weight: 600, family: 'var(--tp-font-sans)', sample: 'Fila de manutenção' },
  { token: 'tp-text-md', size: '16px', use: 'corpo em tela de chão', weight: 400, family: 'var(--tp-font-sans)', sample: 'Alternador não carrega' },
  { token: 'tp-text-base', size: '14px', use: 'corpo', weight: 400, family: 'var(--tp-font-sans)', sample: 'Carro 10001 — ABC1D23' },
  { token: 'tp-text-sm', size: '13px', use: 'texto auxiliar', weight: 400, family: 'var(--tp-font-sans)', sample: 'Sem leitura há 5 dias' },
  { token: 'tp-text-xs', size: '12px', use: 'legenda · mono para código', weight: 500, family: 'var(--tp-font-mono)', sample: 'EV-2026-000142 · 184.320 km' },
  { token: 'tp-text-2xs', size: '11px', use: 'rótulo de tabela', weight: 600, family: 'var(--tp-font-sans)', sample: 'PREFIXO' },
];

function Swatch({ name, hex, note }: { name: string; hex: string; note: string }) {
  return (
    <div className="swatch">
      <div className="swatch__chip" style={{ background: hex }} />
      <div>
        <strong>{name}</strong>
        <code className="tp-muted">{hex}</code>
        <span className="tp-muted">{note}</span>
      </div>
    </div>
  );
}

function Ramp({ label, prefix, steps, anchor }: { label: string; prefix: string; steps: number[]; anchor?: number }) {
  return (
    <div className="ramp">
      <span className="ramp__label">{label}{anchor && <span className="tp-muted"> · {anchor} é a cor do logo</span>}</span>
      <div className="ramp__steps">
        {steps.map((step) => (
          <div key={step} className={`ramp__step${step === anchor ? ' is-anchor' : ''}`} title={`--${prefix}-${step}`}>
            <div style={{ background: `var(--${prefix}-${step})` }} />
            <code>{step}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
