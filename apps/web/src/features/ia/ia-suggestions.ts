/**
 * Atalhos de pergunta por tela: a ia.Transppass responde melhor quando a
 * pergunta já diz o que a pessoa está olhando. Cada rota tem um rótulo
 * (que vai junto com a pergunta, só para o modelo) e três perguntas prontas.
 */
export interface IaScreen {
  label: string;
  suggestions: string[];
}

const SCREENS: { test: (path: string) => boolean; screen: IaScreen }[] = [
  {
    test: (p) => p === '/' || p.startsWith('/?'),
    screen: {
      label: 'Dashboard',
      suggestions: ['O que está segurando a fila agora?', 'Como está o MKBF dos últimos 30 dias?', 'Quais carros estão parados e por quê?'],
    },
  },
  {
    test: (p) => p.startsWith('/consumo/carro/'),
    screen: { label: 'Consumo do carro', suggestions: ['Este carro gasta mais que os iguais a ele?', 'Como foi o rendimento dele mês a mês?', 'Há dias sem registro de abastecimento?'] },
  },
  {
    test: (p) => p.startsWith('/consumo'),
    screen: { label: 'Consumo', suggestions: ['Por que o rendimento do diesel mudou este mês?', 'Quais carros mais fogem do padrão do grupo?', 'Como está o consumo dos elétricos?'] },
  },
  {
    test: (p) => p.startsWith('/indicadores'),
    screen: { label: 'Indicadores', suggestions: ['Resuma o mês em três pontos.', 'Qual foi o pior dia da frota e por quê?', 'Quais linhas mais perderam viagens?'] },
  },
  { test: (p) => p.startsWith('/fila'), screen: { label: 'Fila de manutenção', suggestions: ['Quem está há mais tempo na fila?', 'Quantos carros entraram e saíram da fila hoje?', 'Há falha de segurança esperando?'] } },
  { test: (p) => p.startsWith('/os'), screen: { label: 'Ordens de serviço', suggestions: ['Quais OS estão atrasadas?', 'Quantas OS estão aguardando peça?', 'Qual OS está há mais tempo aberta?'] } },
  { test: (p) => p.startsWith('/eventos'), screen: { label: 'Eventos', suggestions: ['Quais falhas mais se repetiram nos últimos 7 dias?', 'Quais carros mais quebraram este mês?', 'Quantas quebras houve ontem?'] } },
  { test: (p) => p.startsWith('/socorro'), screen: { label: 'Socorro', suggestions: ['Há carro quebrado na rua agora?', 'Quantos socorros foram resolvidos em campo este mês?', 'Qual o tempo médio até o socorro chegar?'] } },
  { test: (p) => p.startsWith('/triagem'), screen: { label: 'Triagem', suggestions: ['O que está aguardando triagem?', 'Como está o SLA de triagem este mês?', 'Quais falhas foram deferidas?'] } },
  { test: (p) => p.startsWith('/preventiva'), screen: { label: 'Preventiva', suggestions: ['Quais carros estão com a preventiva vencida?', 'Quem está mais perto da próxima janela?', 'Como está a aderência à preventiva este mês?'] } },
  { test: (p) => p.startsWith('/frota/'), screen: { label: 'Carro', suggestions: ['Resuma a situação deste carro.', 'Quantas vezes ele quebrou nos últimos 30 dias?', 'Quando é a próxima preventiva dele?'] } },
  { test: (p) => p.startsWith('/frota') || p.startsWith('/painel'), screen: { label: 'Frota', suggestions: ['Como está a frota agora?', 'Quais carros estão fora de operação?', 'Quantos elétricos estão rodando?'] } },
  { test: (p) => p.startsWith('/quilometragem'), screen: { label: 'Quilometragem', suggestions: ['Quanto a frota rodou este mês?', 'Há carros com km degradado?', 'Qual a média de km por dia?'] } },
];

const DEFAULT: IaScreen = {
  label: 'Módulo PCM',
  suggestions: ['Como está a frota agora?', 'Como está o MKBF do mês?', 'O que está segurando a fila?'],
};

export function screenOf(pathname: string): IaScreen {
  return SCREENS.find((s) => s.test(pathname))?.screen ?? DEFAULT;
}
