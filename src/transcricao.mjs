/** Regras puras do debate: nomes de arquivo, veredito, consenso e ciclos. */

export const VEREDITOS = ['CONTINUAR', 'CONSENSO', 'PERGUNTA'];

export function nomeDoTurno(numero, autor) {
  return `${String(numero).padStart(2, '0')}-${autor}.md`;
}

/** Último "VEREDITO: X" do texto, tolerando negrito, crase e citação. Sem veredito: null. */
export function lerVeredito(texto) {
  const regex = /^[\s>*_`#-]*VEREDITO[\s*_`]*[:：][\s*_`]*(CONTINUAR|CONSENSO|PERGUNTA)\b/gim;
  let ultimo = null;
  for (const achado of String(texto).matchAll(regex)) ultimo = achado[1].toUpperCase();
  return ultimo;
}

/** Último "CONFERÊNCIA: OK|CORREÇÕES". */
export function lerConferencia(texto) {
  const regex = /CONFER[ÊE]NCIA[\s*_`]*[:：][\s*_`]*(OK|CORRE[ÇC][ÕO]ES)/gi;
  let ultimo = null;
  for (const achado of String(texto).matchAll(regex)) ultimo = achado[1].toUpperCase().startsWith('OK') ? 'OK' : 'CORRECOES';
  return ultimo;
}

/** Texto da seção "## Pergunta(s) ..." até o próximo título ou a linha do veredito. */
export function extrairPergunta(texto) {
  const linhas = String(texto).split(/\r?\n/);
  const inicio = linhas.findIndex((l) => /^#{1,6}\s*Perguntas?\b/i.test(l));
  const semVeredito = (l) => !/VEREDITO\s*[:：]/i.test(l);
  if (inicio === -1) {
    return linhas.filter(semVeredito).join('\n').trim().slice(-1200);
  }
  const nivel = linhas[inicio].match(/^#+/)[0].length;
  const corpo = [];
  for (const linha of linhas.slice(inicio + 1)) {
    const titulo = linha.match(/^(#+)\s/);
    if ((titulo && titulo[1].length <= nivel) || !semVeredito(linha)) break;
    corpo.push(linha);
  }
  return corpo.join('\n').trim();
}

export function turnosDeAgente(turnos) {
  return turnos.filter((t) => t.tipo === 'agente');
}

/** Consenso = os últimos N turnos são das N IAs, todas diferentes, todas com CONSENSO. */
export function houveConsenso(turnos, participantes) {
  const n = participantes.length;
  const ultimos = turnos.slice(-n);
  if (ultimos.length < n) return false;
  return (
    ultimos.every((t) => t.tipo === 'agente' && t.veredito === 'CONSENSO') &&
    new Set(ultimos.map((t) => t.autor)).size === n
  );
}

/** As IAs falam em rodízio fixo, contando só os turnos de IA. */
export function proximoParticipante(turnos, participantes) {
  return participantes[turnosDeAgente(turnos).length % participantes.length];
}

export function limiteDeTurnos(cfg, estado) {
  return (cfg.max_ciclos + (estado.ciclosExtras ?? 0)) * cfg.participantes.length;
}

export function cicloAtual(turnos, participantes) {
  return Math.floor(turnosDeAgente(turnos).length / participantes.length) + 1;
}

export function ciclosIniciados(turnos, participantes) {
  return Math.ceil(turnosDeAgente(turnos).length / participantes.length);
}
