import { BRAND, Theme, THEME_LABELS } from '@app/design-kit';
import { DOWNTIME_CAUSE_LABELS, DowntimeCause, VEHICLE_STATUS_LABELS } from '@app/shared';
import { useTheme } from '@/features/theme/use-theme';

/**
 * Referência viva do design kit.
 *
 * Renderiza os componentes a partir do CSS de verdade, não de cópias. Uma
 * mudança no kit aparece aqui na hora — é o que impede a documentação de virar
 * ficção, que é o destino habitual de style guide mantido à mão.
 */
export function DesignKitPage() {
  const { theme, setTheme, highContrast, setHighContrast } = useTheme();

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Design kit — Transppass PCM</h2>
            <p className="muted">
              As duas cores vieram do logo da Transppass. Tudo abaixo é renderizado com o CSS
              que a aplicação usa, então esta página não consegue divergir do sistema.
            </p>
          </div>
          <div className="tp-row">
            <select
              className="btn-sm"
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
            >
              {Object.values(Theme).map((t) => (
                <option key={t} value={t}>
                  {THEME_LABELS[t]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setHighContrast(!highContrast)}
            >
              {highContrast ? 'Contraste alto' : 'Contraste normal'}
            </button>
          </div>
        </div>
      </section>

      {/* ---- Marca ---- */}
      <section className="panel">
        <h2>Marca</h2>
        <p className="muted">
          Extraídas do logo: o grafite ocupa 2.631 px do arquivo e o laranja 272 px. Essa
          proporção é a regra de uso — o grafite estrutura, o laranja pontua.
        </p>
        <div className="swatch-grid">
          <Swatch name="Grafite" hex={BRAND.graphite} note="Monograma e wordmark" />
          <Swatch name="Laranja" hex={BRAND.orange} note="O ponto da figura" />
        </div>

        <div className="tp-alert tp-alert--warning">
          <strong>A armadilha da marca laranja</strong>
          <p>
            O laranja <code>#f87509</code> atinge só 2,9:1 sobre branco — reprova em contraste
            para texto. Por isso o kit separa dois tokens: <code>--color-brand</code> para
            preenchimento e identidade, e <code>--color-brand-text</code> (laranja 700, 5,1:1)
            para link e texto pequeno. Trocar um pelo outro é o erro mais fácil de cometer aqui.
          </p>
        </div>
      </section>

      {/* ---- Escalas ---- */}
      <section className="panel">
        <h2>Escalas</h2>
        <Ramp label="Laranja" prefix="tp-orange" steps={SCALE} />
        <Ramp label="Grafite" prefix="tp-graphite" steps={[...SCALE, 950]} />
        <Ramp label="Verde" prefix="tp-green" steps={SEMANTIC_SCALE} />
        <Ramp label="Âmbar" prefix="tp-amber" steps={SEMANTIC_SCALE} />
        <Ramp label="Vermelho" prefix="tp-red" steps={SEMANTIC_SCALE} />
        <Ramp label="Azul" prefix="tp-blue" steps={SEMANTIC_SCALE} />
      </section>

      {/* ---- Tokens semânticos ---- */}
      <section className="panel">
        <h2>Tokens semânticos</h2>
        <p className="muted">
          Nenhum componente conhece "laranja 500"; ele conhece "cor da ação primária". É esta
          camada que troca inteira entre claro e escuro.
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
      <section className="panel">
        <h2>Tipografia</h2>
        <p className="muted">
          Fonte do sistema, sem webfont: a garagem tem conexão instável e a fonte local aparece
          sem salto de layout. Escala de razão 1,2 a partir de 14px.
        </p>
        <div className="type-list">
          {TYPE_SCALE.map((t) => (
            <div key={t.token}>
              <span style={{ fontSize: `var(--${t.token})`, fontWeight: t.weight }}>
                {t.sample}
              </span>
              <code className="muted">
                --{t.token} · {t.size} · {t.use}
              </code>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Botões ---- */}
      <section className="panel">
        <h2>Botões</h2>
        <p className="muted">
          A ação padrão é grafite. O laranja fica para a ação principal da tela — no máximo uma
          por tela, senão deixa de significar alguma coisa.
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
        <p className="muted">
          Socorro, sub-OS, inspeção e limpeza. Mínimo de 48px de altura, texto de 16px — a
          seção 8 do PRD exige operação com uma mão e com luva.
        </p>
        <div className="tp-btn-group">
          <button type="button" className="tp-btn tp-btn--touch tp-btn--secondary">Cheguei</button>
          <button type="button" className="tp-btn tp-btn--touch tp-btn--secondary">Comecei</button>
          <button type="button" className="tp-btn tp-btn--touch tp-btn--primary">Terminei</button>
        </div>
      </section>

      {/* ---- Campos ---- */}
      <section className="panel">
        <h2>Campos</h2>
        <div className="tp-split">
          <div className="tp-stack">
            <div className="tp-field">
              <label className="tp-label" htmlFor="dk-1">
                Prefixo do carro
              </label>
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
              <label className="tp-label" htmlFor="dk-3">
                Leitura do hodômetro
              </label>
              <input
                id="dk-3"
                className="tp-input tp-input--num"
                defaultValue="184320"
                aria-invalid="true"
              />
              <span className="tp-error">
                Delta de 5.240 km é inviável para um dia de operação
              </span>
            </div>
          </div>

          <div className="tp-stack">
            <h3>Escolha</h3>
            <label className="tp-radio-card">
              <input type="radio" name="dk-dest" defaultChecked /> Socorro em campo
            </label>
            <label className="tp-radio-card">
              <input type="radio" name="dk-dest" /> Recolher
            </label>
            <label className="tp-radio-card">
              <input type="radio" name="dk-dest" disabled /> Deferir (bloqueado por segurança)
            </label>

            <h3>Checklist</h3>
            <label className="tp-check">
              <input type="checkbox" defaultChecked /> Conferir tensão de carga
            </label>
            <label className="tp-check">
              <input type="checkbox" /> Testar acionamento
            </label>
          </div>
        </div>
      </section>

      {/* ---- Estados ---- */}
      <section className="panel">
        <h2>Estados do carro</h2>
        <p className="muted">
          Os dez estados do painel se agrupam em quatro leituras operacionais. Dez cores
          ninguém decora; quatro todo mundo entende.
        </p>
        <div className="tp-row">
          {Object.entries(VEHICLE_STATUS_LABELS).map(([status, label]) => (
            <span key={status} className={`badge status-${status.toLowerCase()}`}>
              {label}
            </span>
          ))}
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

      {/* ---- KPI ---- */}
      <section className="panel">
        <h2>Indicadores</h2>
        <div className="tp-kpi-row">
          <div className="tp-kpi tp-kpi--brand">
            <span className="tp-kpi__label">MKBF</span>
            <strong className="tp-kpi__value">8.420 km</strong>
          </div>
          <div className="tp-kpi tp-kpi--good">
            <span className="tp-kpi__label">Disponibilidade</span>
            <strong className="tp-kpi__value">87,4%</strong>
          </div>
          <div className="tp-kpi tp-kpi--warn">
            <span className="tp-kpi__label">Km degradado</span>
            <strong className="tp-kpi__value">3</strong>
            <span className="tp-kpi__note">Sem leitura há mais de 2 dias</span>
          </div>
          <div className="tp-kpi tp-kpi--danger">
            <span className="tp-kpi__label">Prazos vencidos</span>
            <strong className="tp-kpi__value">2</strong>
          </div>
        </div>
      </section>

      {/* ---- Decomposição ---- */}
      <section className="panel">
        <h2>Decomposição da indisponibilidade</h2>
        <p className="muted">
          Paleta categórica com seis matizes distinguíveis lado a lado. A legenda sempre traz o
          texto — a cor é reforço, nunca o único portador da informação.
        </p>
        <div className="bar">
          {BREAKDOWN.map((b) => (
            <div
              key={b.cause}
              className={`bar-seg cause-${b.cause.toLowerCase()}`}
              style={{ width: `${b.share}%` }}
              title={`${DOWNTIME_CAUSE_LABELS[b.cause]}: ${b.share}%`}
            />
          ))}
        </div>
        <ul className="legend">
          {BREAKDOWN.map((b) => (
            <li key={b.cause}>
              <i className={`dot cause-${b.cause.toLowerCase()}`} />
              {DOWNTIME_CAUSE_LABELS[b.cause]} — {b.share}%
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Avisos e portões ---- */}
      <section className="panel">
        <h2>Avisos e portões</h2>
        <div className="tp-stack">
          <div className="tp-alert tp-alert--info">Previsão de retorno atualizada para 14:30.</div>
          <div className="tp-alert tp-alert--success">Carro 10001 liberado.</div>
          <div className="tp-alert tp-alert--warning">
            <strong>Falta para liberar:</strong>
            <ul>
              <li>1 sub-OS sem inspeção: S02</li>
              <li>A limpeza ainda não foi concluída</li>
            </ul>
          </div>
          <div className="tp-alert tp-alert--danger">
            Falha de segurança (PNE-APU-01) não pode ser deferida.
          </div>
        </div>

        <h3>Portões</h3>
        <ul className="tp-gates">
          <li className="tp-gate tp-gate--open">Todas as sub-OS concluídas (RF-19)</li>
          <li className="tp-gate tp-gate--open">Todas as inspeções aprovadas (RF-20)</li>
          <li className="tp-gate">Limpeza concluída (RF-21)</li>
        </ul>
      </section>

      {/* ---- Tabela ---- */}
      <section className="panel">
        <h2>Tabela</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Carro</th>
                <th>Estado</th>
                <th className="num">Km atual</th>
                <th>Última leitura</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="strong">10001</td>
                <td>
                  <span className="badge status-in_line">Em linha</span>
                </td>
                <td className="num">184.320</td>
                <td className="muted">há 1 dia</td>
              </tr>
              <tr className="row-warn">
                <td className="strong">10003</td>
                <td>
                  <span className="badge status-awaiting_part">Aguardando peça</span>
                </td>
                <td className="num">312.045</td>
                <td className="text-warn">há 5 dias</td>
              </tr>
              <tr className="row-error">
                <td className="strong">10002</td>
                <td>
                  <span className="badge status-in_maintenance">Em manutenção</span>
                  <span className="badge badge-danger">segurança</span>
                </td>
                <td className="num">241.870</td>
                <td className="muted">há 1 dia</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Acessibilidade ---- */}
      <section className="panel">
        <h2>Regras que o kit impõe</h2>
        <ul className="rules">
          <li>
            <strong>Cor nunca é o único sinal.</strong> Toda linha marcada e todo segmento de
            barra vêm acompanhados de texto ou etiqueta.
          </li>
          <li>
            <strong>Alvo de chão tem 48px.</strong> Socorro, sub-OS, inspeção e limpeza são
            operados com uma mão e com luva.
          </li>
          <li>
            <strong>Foco sempre visível.</strong> Anel laranja de contorno duplo, que funciona
            sobre fundo claro e escuro. Nunca remover.
          </li>
          <li>
            <strong>Números alinham.</strong> <code>tabular-nums</code> em tabela e KPI — ler km
            em coluna desalinhada é fonte real de erro.
          </li>
          <li>
            <strong>Texto apagado tem limite.</strong> <code>--color-text-muted</code> é o piso
            do que ainda passa em AA; abaixo disso, só decoração.
          </li>
          <li>
            <strong>O escuro não é preto.</strong> Preto puro com texto branco vibra e cansa em
            turno de 8 horas.
          </li>
        </ul>
      </section>
    </>
  );
}

const SCALE = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const SEMANTIC_SCALE = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

const BREAKDOWN: { cause: DowntimeCause; share: number }[] = [
  { cause: DowntimeCause.QUEUE, share: 34 },
  { cause: DowntimeCause.MATERIAL, share: 26 },
  { cause: DowntimeCause.EXECUTION, share: 22 },
  { cause: DowntimeCause.INSPECTION, share: 9 },
  { cause: DowntimeCause.CLEANING, share: 6 },
  { cause: DowntimeCause.RELEASE_WAIT, share: 3 },
];

const SEMANTIC_TOKENS = [
  {
    title: 'Superfície',
    tokens: ['color-bg', 'color-surface', 'color-surface-sunken', 'color-surface-hover'],
  },
  {
    title: 'Texto',
    tokens: ['color-text', 'color-text-secondary', 'color-text-muted', 'color-brand-text'],
  },
  {
    title: 'Marca e ação',
    tokens: ['color-brand', 'color-brand-hover', 'color-action', 'color-focus'],
  },
  {
    title: 'Semântico',
    tokens: ['color-success', 'color-warning', 'color-danger', 'color-info'],
  },
  {
    title: 'Estado do carro',
    tokens: [
      'color-state-running',
      'color-state-waiting',
      'color-state-working',
      'color-state-stopped',
    ],
  },
  {
    title: 'Causas',
    tokens: [
      'color-cause-queue',
      'color-cause-material',
      'color-cause-execution',
      'color-cause-inspection',
      'color-cause-cleaning',
      'color-cause-release-wait',
    ],
  },
];

const TYPE_SCALE = [
  { token: 'tp-text-3xl', size: '36px', use: 'número de destaque', weight: 700, sample: '8.420' },
  { token: 'tp-text-2xl', size: '28px', use: 'valor de KPI', weight: 700, sample: '87,4%' },
  { token: 'tp-text-xl', size: '22px', use: 'título de página', weight: 600, sample: 'Painel da frota' },
  { token: 'tp-text-lg', size: '18px', use: 'título de seção', weight: 600, sample: 'Fila de manutenção' },
  { token: 'tp-text-md', size: '16px', use: 'corpo em tela de chão', weight: 400, sample: 'Alternador não carrega' },
  { token: 'tp-text-base', size: '14px', use: 'corpo', weight: 400, sample: 'Carro 10001 — ABC1D23' },
  { token: 'tp-text-sm', size: '13px', use: 'texto auxiliar', weight: 400, sample: 'Sem leitura há 5 dias' },
  { token: 'tp-text-xs', size: '12px', use: 'legenda e metadado', weight: 400, sample: 'Registrado às 09:14' },
  { token: 'tp-text-2xs', size: '11px', use: 'rótulo de tabela', weight: 600, sample: 'PREFIXO' },
];

function Swatch({ name, hex, note }: { name: string; hex: string; note: string }) {
  return (
    <div className="swatch">
      <div className="swatch__chip" style={{ background: hex }} />
      <div>
        <strong>{name}</strong>
        <code className="muted">{hex}</code>
        <span className="muted">{note}</span>
      </div>
    </div>
  );
}

function Ramp({ label, prefix, steps }: { label: string; prefix: string; steps: number[] }) {
  return (
    <div className="ramp">
      <span className="ramp__label">{label}</span>
      <div className="ramp__steps">
        {steps.map((step) => (
          <div key={step} className="ramp__step" title={`--${prefix}-${step}`}>
            <div style={{ background: `var(--${prefix}-${step})` }} />
            <code>{step}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
