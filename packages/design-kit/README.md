# @app/design-kit

Sistema visual do Transppass — Módulo PCM. Tokens, tema claro/escuro e componentes.

Referência visual compartilhável: **https://claude.ai/code/artifact/0beb3e1d-8f90-4dcb-ada4-f98154f6fcef**
Referência viva dentro do sistema: rota `/design` (perfil Administrador).

## A marca

As duas cores foram extraídas do arquivo do logo institucional, não escolhidas:

| | Hex | No logo | Proporção |
| --- | --- | --- | --- |
| Grafite | `#444544` | Monograma "TP" e wordmark | 2.631 px · 90,6% |
| Laranja | `#f87509` | O ponto da figura | 272 px · 9,4% |

Essa proporção é a regra de uso: o grafite estrutura, o laranja pontua.

## A armadilha do laranja

Toda marca laranja esconde o mesmo problema. Medimos antes de desenhar:

| Combinação | Razão | Veredito |
| --- | --- | --- |
| Branco sobre laranja 500 | 2,79:1 | **Reprova** |
| Laranja 500 sobre branco | 2,79:1 | **Reprova** |
| Grafite 950 sobre laranja 500 | 6,45:1 | Passa |
| Laranja 700 sobre branco | 5,28:1 | Passa |
| Laranja 400 sobre grafite 900 | 6,61:1 | Passa |
| Grafite 700 sobre branco | 9,63:1 | Passa |

Daí a separação de tokens que parecem o mesmo e não são:

- `--color-brand` — o laranja do logo. **Preenche.** Botão de ação principal, indicador, anel de foco.
- `--color-brand-text` — laranja 700 no claro, 400 no escuro. **Escreve.** Link, menu ativo, texto pequeno.
- `--color-text-on-brand` — grafite 950. É o que vai **sobre** o laranja. Nunca branco.

Trocar um pelo outro é o erro mais fácil de cometer aqui.

## As quatro camadas

Cada uma só consome a anterior. Trocar a marca é reescrever a camada 2 — nenhum componente muda.

| | Arquivo | O que faz |
| --- | --- | --- |
| 01 | `primitives.css` | Escalas cruas derivadas das duas cores. Ninguém consome direto. |
| 02 | `semantic.css` | Significado de interface e os três estados de tema. |
| 03 | `base.css` | Reset enxuto, tipografia, anel de foco. Só elementos nativos. |
| 04 | `components.css` | Classes `tp-*`. Nenhuma cor literal. |

## Uso

```ts
import '@app/design-kit/css';

import { applyTheme, Theme } from '@app/design-kit';

applyTheme(Theme.SYSTEM); // remove data-theme; prefers-color-scheme decide
applyTheme(Theme.DARK);   // data-theme="dark"; vence a preferência do SO
```

### Os três estados de tema

O viewer tem três estados, não dois:

```css
:root                              /* claro — palette completa */
@media (prefers-color-scheme: dark)
  :root:not([data-theme='light'])  /* escuro do sistema */
:root[data-theme='dark']           /* escuro escolhido à mão */
```

Toda cor tem definição no bloco claro. Os blocos escuros só redefinem — nenhuma cor existe apenas dentro de uma media query, que é o bug clássico de página ilegível.

### Contraste alto

`data-contrast="high"` engrossa bordas e leva o texto ao extremo da escala. Existe porque a garagem tem iluminação ruim e o pátio tem sol direto na tela do celular (seção 8 do PRD).

## Regras embutidas

Não são recomendação — estão nos componentes, e quebrá-las dá mais trabalho que segui-las.

- **Cor nunca é o único sinal.** Linha marcada e segmento de barra sempre vêm com texto ao lado.
- **Alvo de chão tem 48px.** Socorro, sub-OS, inspeção e limpeza são operados com uma mão e com luva.
- **Foco sempre visível.** Anel laranja de contorno duplo, funciona nos dois temas. Nunca remover.
- **Números alinham.** `tabular-nums` em tabela e KPI — ler km em coluna desalinhada é erro real.
- **O escuro não é preto.** Preto puro com texto branco vibra e cansa em turno de oito horas.
- **Texto apagado tem piso.** `--color-text-muted` é o limite do AA; abaixo disso, só decoração.
- **Um laranja por tela.** A ação padrão é grafite; o laranja é a ação principal daquela tela.

## Estados do carro

Os dez estados do painel (RF-37) se agrupam em quatro leituras operacionais — dez cores ninguém decora, quatro todo mundo entende:

| Família | Estados | Token |
| --- | --- | --- |
| Rodando | disponível, em linha | `--color-state-running` |
| Esperando | triagem, fila, socorro | `--color-state-waiting` |
| Em serviço | manutenção, inspeção, limpeza | `--color-state-working` |
| Parado | aguardando peça, fora de operação | `--color-state-stopped` |

O mapa vive em `VEHICLE_STATE_FAMILY`, exportado do pacote.

## Tipografia

Fonte do sistema, sem webfont: a garagem tem conexão instável e a fonte local aparece sem salto de layout. Escala de razão 1,2 a partir de 14px — densidade alta é intencional, o PCM lê a garagem inteira numa tela só.
