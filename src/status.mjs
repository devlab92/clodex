import path from 'node:path';
import { nomeDoAgente } from './agentes/index.mjs';
import { cor } from './console.mjs';
import { cicloAtual, limiteDeTurnos, proximoParticipante } from './transcricao.mjs';
import { duracao } from './util.mjs';

const MOTIVOS = { consenso: 'consenso entre as IAs', limite: 'limite de ciclos', pedido: 'relatório pedido por você' };

export function corDoVeredito(v) {
  if (v === 'CONSENSO') return cor.verde(v);
  if (v === 'PERGUNTA') return cor.magenta(v);
  return cor.azul(v ?? '—');
}

export function situacao(debate, estado, ativo) {
  const e = estado;
  switch (e?.status ?? 'novo') {
    case 'novo':
      return { texto: 'ainda não começou', proximo: 'revezar iniciar' };
    case 'rodando':
      if (!ativo) return { texto: 'interrompido no meio (o maestro não está rodando)', proximo: 'revezar iniciar' };
      return {
        texto:
          e.fase === 'debate'
            ? `em andamento (vez de ${nomeDoAgente(proximoParticipante(e.turnos, debate.cfg.participantes))})`
            : 'escrevendo o relatório',
        proximo: null,
      };
    case 'aguardando_humano':
      return { texto: cor.magenta('esperando sua resposta'), proximo: 'revezar responder "sua resposta"' };
    case 'pausado':
      return { texto: cor.amarelo('pausado'), proximo: 'revezar retomar' };
    case 'erro':
      return { texto: cor.vermelho(`parado por erro: ${e.erro?.mensagem ?? '?'}`), proximo: 'revezar retomar' };
    case 'parado':
      return { texto: cor.amarelo('parado a seu pedido'), proximo: 'revezar iniciar' };
    case 'concluido':
      return {
        texto: cor.verde(`concluído (${MOTIVOS[e.motivo] ?? e.motivo ?? 'fim'})`),
        proximo: 'revezar continuar --mais 1 --mensagem "..."  (só se quiser mais uma rodada)',
      };
    default:
      return { texto: e.status, proximo: null };
  }
}

export function descreverStatus(debate, estado, { ativo = false } = {}) {
  const { cfg } = debate;
  const e = estado ?? { status: 'novo', turnos: [], fase: 'debate', ciclosExtras: 0 };
  const total = limiteDeTurnos(cfg, e) / cfg.participantes.length;
  const s = situacao(debate, e, ativo);
  const linhas = [
    cor.negrito(`Revezamento · ${cfg.tema}`),
    `Pasta:     ${debate.pasta}`,
    `Situação:  ${s.texto}`,
    `Ciclo:     ${Math.min(cicloAtual(e.turnos, cfg.participantes), total)} de ${total} · autonomia: ${cfg.autonomia} · maestro: ${ativo ? cor.verde('rodando') : 'parado'}`,
    '',
  ];
  if (e.turnos.length) {
    linhas.push(cor.cinza(' Turno  Autor        Veredito      Duração  Arquivo'));
    for (const t of e.turnos) {
      const autor = t.tipo === 'humano' ? cfg.humano : nomeDoAgente(t.autor);
      const veredito =
        t.tipo === 'agente'
          ? corDoVeredito(t.veredito)
          : t.tipo === 'relatorio'
            ? cor.ciano('RELATÓRIO')
            : cor.magenta('FALA');
      const pad = (texto, n) => texto + ' '.repeat(Math.max(1, n - texto.replace(/\x1b\[[0-9;]*m/g, '').length));
      linhas.push(
        ` ${pad(String(t.n).padStart(2, '0'), 7)}${pad(autor, 13)}${pad(veredito, 14)}${pad(t.duracaoS ? duracao(t.duracaoS) : '', 9)}${cor.cinza(t.arquivo)}`,
      );
    }
    linhas.push('');
  }
  if (e.status === 'aguardando_humano' && e.pergunta) {
    linhas.push(cor.magenta(`Pergunta de ${nomeDoAgente(e.pergunta.autor)} (turno ${e.pergunta.turno}):`));
    for (const l of e.pergunta.texto.split('\n')) linhas.push(`  ${l}`);
    linhas.push('');
  }
  const relatorio = [...e.turnos].reverse().find((t) => t.tipo === 'relatorio');
  if (relatorio) linhas.push(`Último relatório: ${path.join(debate.pasta, relatorio.arquivo)}`);
  if (s.proximo) linhas.push(`Próximo passo: ${cor.negrito(s.proximo)}`);
  return linhas.join('\n');
}
