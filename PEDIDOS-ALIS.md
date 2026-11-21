# Pedidos à Alis / Transppass — dados do ERP-JB

Lista do que precisamos pedir ao André (Alis Consult) para completar a carga do sistema. Os nomes de arquivos e colunas seguem a carta "Lista dos Arquivos" de 28/10/2026 e a remessa de 19/11/2026 (janeiro a 19 de novembro).

Para cada item: o que pedimos, por que precisamos e o formato ideal. Os itens 1 e 2 destravam o que hoje aparece zerado no dashboard (tempo parado, disponibilidade histórica, OS liberadas). Os demais são ajustes de qualidade.

Legenda: `[ ]` a pedir · `[~]` pedido, aguardando · `[x]` recebido

---

## 1. `[ ]` Data e hora de abertura e de encerramento da OS (arquivo 4-VBM0805)

**O que pedimos.** Incluir no VBM0805 (ou num relatório complementar, uma linha por O.S.) as colunas:

| Coluna | Formato | Exemplo |
| --- | --- | --- |
| `DATA ABERTURA` + `HORA ABERTURA` | dd/mm/aaaa e hh:mm | 03/11/2026 14:35 |
| `DATA ENCERRAMENTO` + `HORA ENCERRAMENTO` | dd/mm/aaaa e hh:mm | 04/11/2026 09:10 |
| `STATUS O.S.` | texto ou código | ABERTA / ENCERRADA / CANCELADA |
| `DATA ENTRADA OFICINA` (se o JB distinguir da abertura) | dd/mm/aaaa hh:mm | — |

**Por quê.** Hoje o VBM0805 traz só `DATA` (sem hora) e nada sobre quando o carro foi liberado. Sem o encerramento não há como calcular:
- tempo que cada carro ficou parado (indisponibilidade por OS);
- disponibilidade histórica da frota por dia e por faixa horária;
- OS encerradas por período e tempo médio de reparo;
- quais OS estavam **abertas** numa data qualquer (hoje todas aparecem como encerradas).

**Como está hoje.** 141.635 linhas no VBM0805 (uma por serviço/componente), com `DATA`, `CARRO`, `GAR`, `O.S.`, `COMPONENTE`, `RSOS`, `KM SERV`, `KM LIM`, `MEC`, `OBSERVACOES`. Nenhuma coluna de fechamento.

**Observação.** A ficha (VBM0503) já traz `DATA` + `HORA` da abertura. O que falta é só a ponta final da OS. Se o JB não guardar hora de encerramento, a data já ajuda; se guardar só por evento (por exemplo "liberação do carro" no CCOweb), aceitamos vir de lá, desde que haja a chave para ligar à O.S.

---

## 2. `[ ]` Situação atual da garagem (OS abertas e carros parados hoje)

**O que pedimos.** Um relatório, na data da extração, com os carros que estão parados na garagem e a O.S. correspondente: `CARRO`, `O.S.`, `DATA/HORA ABERTURA`, `MOTIVO`, `SETOR/ETAPA` (fila, oficina, aguardando peça, pronto). Pode ser o mesmo VBM0805 filtrado por `STATUS O.S. = ABERTA`, se o item 1 for atendido.

**Por quê.** O sistema separa **histórico** (o que aconteceu) de **estado** (o que está acontecendo agora). Os arquivos atuais só trazem histórico, então o dashboard mostra 460 carros "prontos no pátio" e zero na fila, o que não é a realidade da garagem.

---

## 3. `[ ]` Cadência de envio dos arquivos

**O que pedimos.** Definir a periodicidade de entrega dos mesmos onze arquivos (sugestão: diária para 2-VBM0406_km, 3-VBM0503, 3-CCOweb e 4-VBM0805; semanal para os demais), e o horário/caminho de disponibilização (e-mail, pasta compartilhada ou SFTP). Se possível, exportação automática pelo próprio JB.

**Por quê.** A remessa de 19/11 vale até 19/11. Hoje (22/11) o sistema já acusa "460 carros sem leitura de km há 2+ dias", porque os dados pararam ali. Para o MKBF e a disponibilidade acompanharem a operação, os dados precisam chegar com atraso de no máximo um dia.

---

## 4. `[ ]` Hora de retorno/liberação do socorro (ficha tipo S, arquivo 3-VBM0503)

**O que pedimos.** Para as fichas de socorro (coluna `T = S`), a hora em que o socorro chegou ao carro e a hora em que o carro voltou a rodar ou foi recolhido. Se o CCOweb registrar isso (`Hora_Fim`, `Hora_Liberação` ou similar), basta incluir a coluna no 3-CCOweb.

**Por quê.** Permite medir o tempo de atendimento do socorro e separar "resolvido na rua" de "recolhido", que são indicadores do plantão. Hoje só temos a `HORA` de abertura da ficha.

---

## 5. `[ ]` Cadastro de mecânicos (registro → nome e especialidade)

**O que pedimos.** Tabela com `REGISTRO` (o mesmo código das colunas `MEC` do VBM0503/VBM0805 e `FUNC.` do VBM0404), `NOME`, `ESPECIALIDADE` (mecânica, elétrica, funilaria, pneus, ar-condicionado…), `TURNO` e `SITUAÇÃO` (ativo/desligado).

**Por quê.** Hoje as telas mostram só o número do registro (ex.: `09965`). Com o cadastro, a OS mostra quem executou, e os indicadores por especialidade e por técnico passam a funcionar.

---

## 6. `[ ]` Descrição dos tipos de ficha (coluna `T` do 3-VBM0503)

**O que pedimos.** Confirmar a descrição de todos os códigos da coluna `T`. O arquivo "3-Códigos VBM0503" cobre A, S e T (e alguns outros), mas na base aparecem também:

| Código | Qtde na remessa | Descrição que assumimos | Confirmar? |
| --- | --- | --- | --- |
| G | 49.379 | Garagem | sim |
| R | 4.445 | Recolhida normal | sim |
| D | 3.756 | Diário (não estava na lista de códigos) | **sim** |
| V | 1.541 | Valetamento | sim |
| O | 1.528 | Operacional | sim |
| P | 295 | Rodagem | sim |

**Por quê.** Esses tipos aparecem nos filtros e no histórico de manutenção. Se a descrição estiver errada, o usuário vai ler errado.

---

## 7. `[ ]` Modelos de chassi ausentes na tabela "MODELO DO CHASSI"

**O que pedimos.** Incluir na tabela os dois modelos que aparecem no 1-VBM0208 mas não estão classificados: `VW31.320 6X4` e `MBATRON 1635 S/45` (1 carro cada). Informar classe (padron, básico, articulado…) e tecnologia (diesel/elétrico).

**Por quê.** Sem classificação esses carros ficam sem classe no sistema e fora do plano preventivo por modelo.

---

## 8. `[ ]` Prefixos que aparecem nas fichas e no CCO mas não estão na frota ativa

**O que pedimos.** Confirmar o que são estes veículos e se devem ser ignorados:

- **1.200 fichas** do VBM0503 e **2.079 itens** do VBM0805 com `CARRO` fora da frota do VBM0208 (status 0/7/17 sem desligamento).
- No CCOweb, ocorrências de prefixos como `81964`, `81756`, `81951`, `81957`, `80106`, `80162`, `80161`, `80174`, `80178`, `80261`, `80210`, `80500`, `81500`, `280`, `200`, `2002`. Pela carta (item 2.1.7) seriam veículos de apoio da manutenção; queremos a confirmação e, se forem carros desligados no período, a data de desligamento.

**Por quê.** Hoje descartamos esses registros. Se algum for carro da frota (por exemplo, carro que saiu de operação em outubro), ele deveria contar no MKBF do período em que rodou.

---

## 9. `[ ]` Peças sem O.S. correspondente (arquivo 8-VBM0404)

**O que pedimos.** Explicar os **11.196 lançamentos de peças** (de 115.321) cuja `O.S.` não existe no VBM0805 nem no VBM0503. São OS de outro período, requisições sem OS (consumo de almoxarifado) ou erro de apontamento? Se houver um tipo de requisição no JB, incluir a coluna `TIPO REQUISIÇÃO`.

**Por quê.** Esses lançamentos somam custo de peças que hoje não conseguimos atribuir a carro nem a intervenção. Isso afeta o custo por OS e o custo por km.

---

## 10. `[ ]` Data de geração do 1-VBM0208 (hodômetro atual)

**O que pedimos.** Informar, a cada remessa, a data e hora em que o VBM0208 foi gerado (pode ser no nome do arquivo ou numa linha de cabeçalho).

**Por quê.** O hodômetro de cada dia é calculado de trás para a frente: `KM CHASSI` atual menos a rodagem diária do VBM0406. Se não sabemos a data exata da leitura de `KM CHASSI`, o cálculo desloca um ou dois dias e distorce o MKBF do mês corrente.

---

## 11. `[ ]` OS sem ficha (RSOS em branco no 4-VBM0805)

**O que pedimos.** Confirmar a interpretação: OS com `RSOS` vazio e `KM LIM > 0` são preventivas (como diz o item 6 da carta); OS com `RSOS` vazio e `KM LIM` vazio são corretivas abertas pela própria oficina, sem ficha de motorista. São **5.697 OS** nesse segundo caso. Se houver um campo de origem da OS no JB (motorista, oficina, inspeção, preventiva), incluir.

**Por quê.** Define se essas OS devem contar como quebra, como manutenção programada ou como retrabalho.

---

## 12. `[ ]` Garantias e reclamações de peças (módulo do almoxarifado)

**O que pedimos.** A carta cita que "os dados de controle das garantias e reclamações estão no módulo do almoxarifado". Pedir a exportação: `MATERIAL`, `FORNECEDOR`, `NF`, `DATA APLICAÇÃO`, `O.S.`, `DATA RECLAMAÇÃO`, `MOTIVO`, `STATUS`, `PRAZO`.

**Por quê.** Alimenta a tela "Qualidade de peças" (garantia por fornecedor e SLA de reclamação), que hoje só tem dados de exemplo.

---

## 13. `[ ]` Programação de linhas por tabela e tecnologia

**O que pedimos.** A tabela de programação do JB (linha × tabela × tecnologia/lote × horários), citada na nota do item 7.2 da carta.

**Por quê.** Permite calcular viagens perdidas por carro e por linha com mais precisão do que a comparação `VPOpe − V_moni` do 7-Viagens, e cruzar quebra com a tabela que o carro estava cumprindo.

---

## 14. `[ ]` Dias sem registro na planilha de consumo (M04 - Litros_kwh)

**O que pedimos.** O complemento da planilha de abastecimento e recarga para os dias que vieram sem nenhum registro: **30/01, 31/01 (elétricos) e 31/07 (diesel e elétricos)**. A frota rodou normalmente nesses dias (o km está no 2-KM), só o consumo não veio.

**Por quê.** Sem o registro, o km desses dias ficaria no denominador sem o combustível no numerador e derrubaria o km/l do período. O sistema já detecta o dia e o tira da conta (a tela avisa "dia sem planilha de consumo"), mas o certo é ter o dado.

**Como está hoje.** Detecção automática na carga: cada dia sem planilha vira aviso para o PCM. O mesmo vale para carros com odômetro parado (abastecem e o km não anda por 5+ registros seguidos; 4 carros em 2026: 095 em março, 151 e 375 em abril, 996 em julho e agosto) — esse é problema da leitura de km, não da planilha de consumo, e fica para o 2-KM.

---

## Resumo para a mensagem ao André

Se for mandar um e-mail curto, os três primeiros itens são os que mudam o sistema de "histórico" para "operação":

1. **Encerramento da OS** (data/hora e status) no VBM0805.
2. **OS abertas / carros parados hoje**, na data da extração.
3. **Cadência diária** dos arquivos de km, fichas, CCO e OS.

Os demais podem vir numa segunda rodada.
