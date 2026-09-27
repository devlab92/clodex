import fs from 'node:fs';
import path from 'node:path';
import { AGENTES, nomeDoAgente } from './agentes/index.mjs';
import { carregarDebate, verificarPauta } from './config.mjs';
import { cor, criarConsole, semCor } from './console.mjs';
import {
  adquirirTrava,
  esvaziarCaixa,
  estadoInicial,
  lerEstado,
  liberarTrava,
  pastaInterna,
  registrarUltimo,
  salvarEstado,
} from './estado.mjs';
import { executarProcesso } from './executar.mjs';
import { notificar } from './notificar.mjs';
import { promptDaConferencia, promptDoRelatorio, promptDoTurno } from './prompts.mjs';
import { corDoVeredito, descreverStatus } from './status.mjs';
import {
  cicloAtual,
  ciclosIniciados,
  extrairPergunta,
  houveConsenso,
  lerConferencia,
  lerVeredito,
  limiteDeTurnos,
  nomeDoTurno,
  proximoParticipante,
  turnosDeAgente,
} from './transcricao.mjs';
import { ErroAmigavel, dataHoraLocal, dormir, duracao, hashDoArquivo, resolverTexto } from './util.mjs';

/** Roda (ou retoma) o debate até concluir, parar a pedido, ou o processo ser encerrado. */
export function iniciar(pasta, opcoes = {}) {
  return new Maestro(pasta, opcoes).executar('iniciar');
}

/** Reabre um debate com mais `mais` ciclos, opcionalmente com uma fala sua antes. */
export function continuar(pasta, { mais = 1, mensagem } = {}, opcoes = {}) {
  return new Maestro(pasta, opcoes).executar('continuar', { mais, mensagem });
}

/** Gera o relatório agora, com o que houver de debate. */
export function gerarRelatorio(pasta, opcoes = {}) {
  return new Maestro(pasta, opcoes).executar('relatorio');
}

const primeiraLinha = (texto) => String(texto).trim().split(/\r?\n/)[0].slice(0, 300);

export class Maestro {
  constructor(pasta, opcoes) {
    this.debate = carregarDebate(pasta);
    this.opcoes = { intervaloCaixaMs: 1000, intervaloEsperaMs: 300, batimentoMs: 60_000, ...opcoes };
    this.ctl = { falas: [], pararDepois: false, pausar: false, retomar: false, abort: null, ctrlC: 0 };
    this.emTurno = false;
    this.avisados = new Set();
  }

  get cfg() {
    return this.debate.cfg;
  }

  async executar(modo, extras = {}) {
    verificarPauta(this.debate.pasta);
    adquirirTrava(this.debate.pasta);
    registrarUltimo(this.debate.pasta);
    this.ui =
      this.opcoes.ui ??
      criarConsole({
        interativo: this.opcoes.interativo ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
        aoDigitar: (linha) => this.aoDigitar(linha),
        aoInterromper: () => this.aoCtrlC(),
      });
    const aoSigint = () => this.aoCtrlC();
    if (!this.ui.interativo) process.on('SIGINT', aoSigint);
    const relogioDaCaixa = setInterval(() => this.lerCaixa(), this.opcoes.intervaloCaixaMs);
    try {
      this.estado = lerEstado(this.debate.pasta) ?? estadoInicial(this.cfg);
      this.preparar(modo, extras);
      this.salvar();
      this.cabecalho();
      this.lerCaixa();
      await this.laco();
    } finally {
      clearInterval(relogioDaCaixa);
      process.off('SIGINT', aoSigint);
      this.ui.fechar();
      liberarTrava(this.debate.pasta);
    }
    return this.estado;
  }

  preparar(modo, extras) {
    const e = this.estado;
    e.tema = this.cfg.tema;
    if (modo === 'iniciar') {
      if (e.status === 'concluido') {
        throw new ErroAmigavel(
          'Este debate já terminou. Para mais uma rodada: revezar continuar --mais 1 --mensagem "o que você decidiu"',
        );
      }
      if (e.status !== 'aguardando_humano') {
        e.status = 'rodando';
        e.erro = null;
      }
    } else if (modo === 'continuar') {
      const mais = Number(extras.mais ?? 1);
      if (!Number.isInteger(mais) || mais < 1) throw new ErroAmigavel('--mais deve ser um inteiro ≥ 1');
      e.ciclosExtras = ciclosIniciados(e.turnos, this.cfg.participantes) + mais - this.cfg.max_ciclos;
      e.inicioRodada = e.turnos.length;
      Object.assign(e, { fase: 'debate', motivo: null, erro: null, relatorioAtual: null });
      if (extras.mensagem) this.ctl.falas.push(resolverTexto(extras.mensagem));
      if (e.status !== 'aguardando_humano' || extras.mensagem) e.status = 'rodando';
    } else if (modo === 'relatorio') {
      if (!this.cfg.relator) throw new ErroAmigavel('"relator" está null no revezamento.json: não há quem escreva o relatório.');
      Object.assign(e, { fase: 'relatorio', motivo: 'pedido', status: 'rodando', erro: null, pergunta: null });
    }
  }

  // ---------- laço principal ----------

  async laco() {
    const e = this.estado;
    while (true) {
      this.gravarFalas();
      if (this.ctl.pararDepois) return this.encerrarPorPedido();
      if (e.status === 'aguardando_humano') {
        await this.esperar(() => this.ctl.falas.length > 0 || this.ctl.pararDepois);
        continue;
      }
      if (this.ctl.pausar) {
        await this.pausa();
        continue;
      }
      if (e.status === 'erro') {
        await this.esperar(() => this.ctl.retomar || this.ctl.pararDepois);
        if (this.ctl.retomar) {
          this.ctl.retomar = false;
          Object.assign(e, { status: 'rodando', erro: null });
          this.salvar();
          this.log(cor.ciano('▶ Tentando de novo.'));
        }
        continue;
      }
      if (e.fase === 'debate') {
        const fim = this.condicaoDeFim();
        if (fim) this.fimDoDebate(fim);
        else await this.turnoDeAgente();
        continue;
      }
      if (e.fase === 'relatorio') {
        await this.etapaDoRelatorio();
        continue;
      }
      return this.finalizar();
    }
  }

  condicaoDeFim() {
    const e = this.estado;
    if (houveConsenso(e.turnos.slice(e.inicioRodada), this.cfg.participantes)) return 'consenso';
    if (turnosDeAgente(e.turnos).length >= limiteDeTurnos(this.cfg, e)) return 'limite';
    return null;
  }

  fimDoDebate(motivo) {
    const e = this.estado;
    e.motivo = motivo;
    const total = limiteDeTurnos(this.cfg, e) / this.cfg.participantes.length;
    this.log(
      motivo === 'consenso'
        ? cor.verde('★ Consenso: todas as IAs concordaram.')
        : cor.amarelo(`★ Limite de ${total} ciclo(s) atingido.`),
    );
    e.fase = this.cfg.relator ? 'relatorio' : 'fim';
    this.salvar();
  }

  // ---------- turnos ----------

  async turnoDeAgente() {
    const e = this.estado;
    const { cfg } = this;
    const agente = proximoParticipante(e.turnos, cfg.participantes);
    const numero = e.turnos.length + 1;
    const arquivo = nomeDoTurno(numero, agente);
    const limite = limiteDeTurnos(cfg, e);
    const ciclo = cicloAtual(e.turnos, cfg.participantes);
    const totalCiclos = limite / cfg.participantes.length;
    const pastaAnexos = path.join(this.debate.pasta, 'anexos', path.basename(arquivo, '.md'));
    this.verificarIntegridade();
    if (cfg.permissoes === 'escrita') fs.mkdirSync(pastaAnexos, { recursive: true });

    const prompt = promptDoTurno({
      debate: this.debate,
      agente,
      numero,
      arquivo,
      turnos: e.turnos,
      pastaAnexos,
      turnoDeIA: turnosDeAgente(e.turnos).length + 1,
      limite,
      ciclo,
      totalCiclos,
    });
    this.log(`${cor.ciano('▶')} Turno ${numero} · ${cor.negrito(nomeDoAgente(agente))} começou ${cor.cinza(`(ciclo ${ciclo} de ${totalCiclos})`)}`);
    const r = await this.rodarAgente({ agente, rotulo: `turno ${numero}`, base: path.basename(arquivo, '.md'), prompt, modo: cfg.permissoes, pastaAnexos });
    if (cfg.permissoes === 'escrita') removerSeVazia(pastaAnexos);
    if (!r.ok) {
      if (r.cancelado) this.log(cor.amarelo(`■ Turno ${numero} interrompido. Nada foi gravado.`));
      else this.falhar(`Turno ${numero} (${nomeDoAgente(agente)}): ${primeiraLinha(r.erro?.message)}`);
      return;
    }

    const veredito = lerVeredito(r.texto);
    if (!veredito) this.log(cor.amarelo(`⚠ ${nomeDoAgente(agente)} não escreveu a linha VEREDITO. Tratei como CONTINUAR.`));
    const cabecalho = `<!-- revezar · turno ${numero} · ${nomeDoAgente(agente)} · ${dataHoraLocal()} · ${duracao(r.duracaoS)} -->\n\n`;
    this.gravarTurno({
      numero,
      tipo: 'agente',
      autor: agente,
      arquivo,
      conteudo: `${cabecalho}${r.texto.trim()}\n`,
      extras: {
        veredito: veredito ?? 'CONTINUAR',
        ...(veredito ? {} : { vereditoAusente: true }),
        duracaoS: Math.round(r.duracaoS),
        tentativas: r.tentativas,
        sessao: r.sessao ?? null,
        custoUsd: r.custoUsd ?? null,
      },
    });
    this.log(`${cor.verde('✔')} Turno ${numero} · ${nomeDoAgente(agente)} terminou em ${duracao(r.duracaoS)} · ${corDoVeredito(veredito ?? 'CONTINUAR')} · ${cor.cinza(arquivo)}`);

    if (veredito === 'PERGUNTA') {
      e.status = 'aguardando_humano';
      e.pergunta = { turno: numero, autor: agente, texto: extrairPergunta(r.texto) };
      this.mostrarPergunta();
      this.avisar(`${nomeDoAgente(agente)} precisa de você`, e.pergunta.texto);
    }
    this.salvar();
  }

  async etapaDoRelatorio() {
    const e = this.estado;
    const { cfg } = this;
    const relator = cfg.relator;
    if (!e.relatorioAtual) {
      const numero = e.turnos.length + 1;
      const arquivo = nomeDoTurno(numero, 'relatorio');
      const prompt = promptDoRelatorio({ debate: this.debate, relator, arquivo, turnos: e.turnos, motivo: e.motivo });
      this.log(`${cor.ciano('▶')} Relatório · ${cor.negrito(nomeDoAgente(relator))} está escrevendo ${cor.cinza(`(turno ${numero})`)}`);
      const r = await this.rodarAgente({ agente: relator, rotulo: 'relatório', base: path.basename(arquivo, '.md'), prompt, modo: 'leitura' });
      if (!r.ok) {
        if (!r.cancelado) this.falhar(`Relatório (${nomeDoAgente(relator)}): ${primeiraLinha(r.erro?.message)}`);
        return;
      }
      this.gravarTurno({
        numero,
        tipo: 'relatorio',
        autor: relator,
        arquivo,
        conteudo: `<!-- revezar · relatório · ${nomeDoAgente(relator)} · ${dataHoraLocal()} · ${duracao(r.duracaoS)} -->\n\n${r.texto.trim()}\n`,
        extras: { motivo: e.motivo, duracaoS: Math.round(r.duracaoS), sessao: r.sessao ?? null, conferencias: [] },
      });
      e.relatorioAtual = { numero, arquivo };
      this.salvar();
      this.log(`${cor.verde('✔')} Relatório escrito em ${duracao(r.duracaoS)} · ${cor.cinza(arquivo)}`);
    }

    if (cfg.conferencia_do_relatorio) {
      const turnoRel = e.turnos.find((t) => t.n === e.relatorioAtual.numero);
      for (const agente of cfg.participantes.filter((p) => p !== relator)) {
        if (turnoRel.conferencias.some((c) => c.autor === agente)) continue;
        this.log(`${cor.ciano('▶')} Conferência · ${cor.negrito(nomeDoAgente(agente))} está conferindo o relatório`);
        const r = await this.rodarAgente({
          agente,
          rotulo: 'conferência',
          base: `${path.basename(turnoRel.arquivo, '.md')}-conferencia-${agente}`,
          prompt: promptDaConferencia({ debate: this.debate, agente, relator, arquivoRelatorio: turnoRel.arquivo }),
          modo: 'leitura',
        });
        if (!r.ok) {
          if (!r.cancelado) this.falhar(`Conferência (${nomeDoAgente(agente)}): ${primeiraLinha(r.erro?.message)}`);
          return;
        }
        const resultado = lerConferencia(r.texto) ?? '?';
        const destino = path.join(this.debate.pasta, turnoRel.arquivo);
        fs.appendFileSync(destino, `\n---\n\n## Conferência de ${nomeDoAgente(agente)}\n\n${r.texto.trim()}\n`);
        turnoRel.conferencias.push({ autor: agente, resultado, duracaoS: Math.round(r.duracaoS), sessao: r.sessao ?? null });
        turnoRel.hash = hashDoArquivo(destino);
        this.salvar();
        const leitura = { OK: cor.verde('confere'), CORRECOES: cor.amarelo('pediu correções (estão no fim do relatório)') }[resultado] ?? cor.amarelo('não indicou o resultado');
        this.log(`${cor.verde('✔')} ${nomeDoAgente(agente)} conferiu o relatório: ${leitura}`);
      }
    }
    Object.assign(e, { fase: 'fim', relatorioAtual: null });
    this.salvar();
  }

  /** Roda uma IA com as tentativas configuradas. Devolve { ok, texto, … } ou { ok: false, erro | cancelado }. */
  async rodarAgente({ agente, rotulo, base, prompt, modo, pastaAnexos }) {
    const adaptador = AGENTES[agente];
    const cfgA = this.cfg.agentes[agente];
    const comando = cfgA.comando ?? adaptador.localizar()?.caminho;
    if (!comando) return { ok: false, erro: new Error(`não encontrei o ${adaptador.nome}. ${adaptador.comoInstalar}`) };
    const interna = pastaInterna(this.debate.pasta);
    for (const sub of ['prompts', 'saidas']) fs.mkdirSync(path.join(interna, sub), { recursive: true });
    fs.writeFileSync(path.join(interna, 'prompts', `${base}.md`), prompt);

    const inicio = Date.now();
    this.emTurno = true;
    const batimento = setInterval(
      () => this.log(cor.cinza(`  … ${adaptador.nome} trabalhando há ${duracao((Date.now() - inicio) / 1000)}`)),
      this.opcoes.batimentoMs,
    );
    let ultimoErro = null;
    try {
      for (let tentativa = 1; tentativa <= this.cfg.tentativas_por_turno; tentativa++) {
        const nome = tentativa > 1 ? `${base}-tentativa${tentativa}` : base;
        const plano = adaptador.montar({
          comando: Array.isArray(comando) ? comando : [comando],
          prompt,
          modo,
          raiz: this.debate.raiz,
          pastaAnexos,
          arquivoUltimaMensagem: path.join(interna, 'saidas', `${nome}.ultima-mensagem.md`),
          cfg: cfgA,
          rotulo: `${this.cfg.tema} · ${rotulo}`,
        });
        this.ctl.abort = new AbortController();
        const res = await executarProcesso({
          ...plano,
          tempoMaxMs: this.cfg.tempo_max_turno_min * 60_000,
          sinal: this.ctl.abort.signal,
        });
        fs.writeFileSync(path.join(interna, 'saidas', `${nome}.stdout.txt`), res.stdout);
        if (res.stderr) fs.writeFileSync(path.join(interna, 'saidas', `${nome}.stderr.txt`), res.stderr);
        if (res.cancelado) return { ok: false, cancelado: true };
        try {
          if (res.tempoEsgotado) throw new Error(`passou do tempo máximo de ${this.cfg.tempo_max_turno_min} min`);
          const saida = adaptador.interpretar(res, plano);
          if (!saida.texto?.trim()) throw new Error('a resposta veio vazia');
          return { ok: true, ...saida, duracaoS: (Date.now() - inicio) / 1000, tentativas: tentativa };
        } catch (erro) {
          ultimoErro = erro;
          const deNovo = tentativa < this.cfg.tentativas_por_turno && !this.ctl.pararDepois;
          this.log(cor.amarelo(`⚠ ${adaptador.nome}, tentativa ${tentativa}: ${primeiraLinha(erro.message)}${deNovo ? '. Tentando de novo.' : ''}`));
          if (!deNovo) break;
        }
      }
      return { ok: false, erro: ultimoErro };
    } finally {
      clearInterval(batimento);
      this.emTurno = false;
      this.ctl.abort = null;
    }
  }

  gravarFalas() {
    if (!this.ctl.falas.length) return;
    const e = this.estado;
    const textos = this.ctl.falas.splice(0);
    const numero = e.turnos.length + 1;
    const arquivo = nomeDoTurno(numero, this.debate.humanoSlug);
    const resposta = e.status === 'aguardando_humano' ? e.pergunta : null;
    const contexto = resposta ? `_Em resposta à pergunta de ${nomeDoAgente(resposta.autor)} no turno ${resposta.turno}._\n\n` : '';
    this.gravarTurno({
      numero,
      tipo: 'humano',
      autor: this.debate.humanoSlug,
      arquivo,
      conteudo: `<!-- revezar · turno ${numero} · ${this.cfg.humano} · ${dataHoraLocal()} -->\n\n# ${this.cfg.humano} · turno ${numero}\n\n${contexto}${textos.join('\n\n')}\n`,
      extras: resposta ? { respondeA: resposta.turno } : {},
    });
    if (e.status === 'aguardando_humano') Object.assign(e, { status: 'rodando', pergunta: null });
    this.salvar();
    this.log(`${cor.magenta('✎')} Turno ${numero} · ${this.cfg.humano}: sua fala foi gravada ${cor.cinza(arquivo)}`);
  }

  gravarTurno({ numero, tipo, autor, arquivo, conteudo, extras = {} }) {
    const destino = path.join(this.debate.pasta, arquivo);
    if (fs.existsSync(destino)) {
      // A IA criou o arquivo do turno por conta própria: guarda como anexo em vez de sobrescrever.
      const guarda = path.join(this.debate.pasta, 'anexos', path.basename(arquivo, '.md'));
      fs.mkdirSync(guarda, { recursive: true });
      fs.renameSync(destino, path.join(guarda, `criado-pelo-agente-${arquivo}`));
      this.log(cor.amarelo(`⚠ ${arquivo} já existia (criado fora do maestro). Movi para anexos/${path.basename(arquivo, '.md')}/.`));
    }
    fs.writeFileSync(destino, conteudo);
    this.estado.turnos.push({ n: numero, tipo, autor, arquivo, hash: hashDoArquivo(destino), em: new Date().toISOString(), ...extras });
  }

  verificarIntegridade() {
    for (const t of this.estado.turnos) {
      if (!t.hash || this.avisados.has(t.arquivo)) continue;
      const atual = hashDoArquivo(path.join(this.debate.pasta, t.arquivo));
      if (atual !== t.hash) {
        this.avisados.add(t.arquivo);
        this.log(cor.amarelo(`⚠ ${t.arquivo} foi ${atual ? 'alterado' : 'apagado'} depois de gravado. As IAs vão ler a versão atual.`));
      }
    }
  }

  // ---------- pausas, erros e fim ----------

  async pausa() {
    const e = this.estado;
    e.status = 'pausado';
    this.salvar();
    this.log(cor.amarelo(`⏸ Pausado. Para continuar: ${this.ui.interativo ? '/retomar' : 'revezar retomar'}`));
    await this.esperar(() => !this.ctl.pausar || this.ctl.pararDepois);
    if (!this.ctl.pararDepois) {
      e.status = 'rodando';
      this.salvar();
      this.log(cor.ciano('▶ Retomado.'));
    }
  }

  falhar(mensagem) {
    const e = this.estado;
    Object.assign(e, { status: 'erro', erro: { mensagem, em: new Date().toISOString() } });
    this.ctl.retomar = false;
    this.salvar();
    this.log(cor.vermelho(`✖ ${mensagem}`));
    this.log(
      `  Detalhes em ${path.join('.revezar', 'saidas')}. ` +
        (this.ui.interativo
          ? 'Digite /retomar para tentar de novo, ou /parar para sair (e depois: revezar iniciar).'
          : 'Para tentar de novo: revezar retomar · para sair: revezar parar'),
    );
    this.avisar('O debate parou por um erro', mensagem);
  }

  encerrarPorPedido() {
    const e = this.estado;
    if (e.status !== 'aguardando_humano') e.status = 'parado';
    this.salvar();
    this.log(`${cor.amarelo('■ Maestro parado.')} Para continuar de onde parou: ${cor.negrito('revezar iniciar')}`);
  }

  finalizar() {
    const e = this.estado;
    Object.assign(e, { status: 'concluido', pergunta: null });
    this.salvar();
    const relatorio = [...e.turnos].reverse().find((t) => t.tipo === 'relatorio' && t.n > e.inicioRodada);
    this.log('');
    this.log(cor.negrito(cor.verde('■ Debate concluído.')));
    if (relatorio) this.log(`  Relatório: ${cor.negrito(path.join(this.debate.pasta, relatorio.arquivo))}`);
    this.log(`  Quer mais uma rodada com suas decisões? ${cor.negrito('revezar continuar --mais 1 --mensagem "..."')}`);
    this.avisar('Debate concluído', relatorio ? `Relatório pronto: ${relatorio.arquivo}` : 'Veja os turnos na pasta do debate.');
  }

  // ---------- entrada do humano ----------

  receber(msg) {
    switch (msg.tipo) {
      case 'fala': {
        const texto = String(msg.texto ?? '').trim();
        if (!texto) return;
        this.ctl.falas.push(texto);
        this.log(
          this.estado?.status === 'aguardando_humano'
            ? cor.verde('✉ Resposta recebida. O debate continua.')
            : cor.verde(`✉ Fala recebida. Entra ${this.emTurno ? 'assim que este turno terminar' : 'antes do próximo turno'}.`),
        );
        break;
      }
      case 'pausar':
        if (!this.ctl.pausar) {
          this.ctl.pausar = true;
          this.log(cor.amarelo(this.emTurno ? '⏸ Vou pausar quando este turno terminar.' : '⏸ Pausa pedida.'));
        }
        break;
      case 'retomar':
        this.ctl.pausar = false;
        this.ctl.retomar = true;
        break;
      case 'parar':
        if (!this.ctl.pararDepois) {
          this.ctl.pararDepois = true;
          if (this.emTurno) this.log(cor.amarelo(`■ Vou parar quando este turno terminar. Para parar já: ${this.ui?.interativo ? '/parar agora' : 'revezar parar --agora'}`));
        }
        break;
      case 'parar_agora':
        this.ctl.pararDepois = true;
        if (this.ctl.abort) {
          this.log(cor.amarelo('■ Parando agora: a IA em andamento foi interrompida.'));
          this.ctl.abort.abort();
        }
        break;
    }
  }

  aoDigitar(linha) {
    const t = linha.trim();
    if (!t) return;
    if (t.startsWith('/')) {
      const comando = t.slice(1).trim().toLowerCase().replace(/[\s-]+/g, ' ');
      if (comando === 'parar agora') return this.receber({ tipo: 'parar_agora' });
      if (['parar', 'pausar', 'retomar'].includes(comando)) return this.receber({ tipo: comando });
      if (comando === 'status') return this.log(descreverStatus(this.debate, this.estado, { ativo: true }));
      if (comando === 'ajuda' || comando === '?') return this.mostrarAjuda();
      return this.log(cor.vermelho(`Comando desconhecido: ${t}. Digite /ajuda.`));
    }
    try {
      this.receber({ tipo: 'fala', texto: resolverTexto(t) });
    } catch (erro) {
      this.log(cor.vermelho(erro.message));
    }
  }

  aoCtrlC() {
    this.ctl.ctrlC += 1;
    if (this.ctl.ctrlC === 1 && this.emTurno) {
      this.receber({ tipo: 'parar' });
      this.log(cor.cinza('(Ctrl+C de novo para parar já.)'));
    } else {
      this.receber({ tipo: 'parar_agora' });
    }
  }

  lerCaixa() {
    for (const msg of esvaziarCaixa(this.debate.pasta)) this.receber(msg);
  }

  // ---------- saída ----------

  cabecalho() {
    const { cfg } = this;
    const e = this.estado;
    const ordem = cfg.participantes.map(nomeDoAgente).join(' → ');
    this.log(cor.negrito(`━━ Revezamento · ${cfg.tema} ━━`));
    this.log(
      cor.cinza(
        `${ordem} · até ${limiteDeTurnos(cfg, e) / cfg.participantes.length} ciclo(s) · autonomia: ${cfg.autonomia} · ` +
          `relator: ${cfg.relator ? nomeDoAgente(cfg.relator) : 'nenhum'} · permissões: ${cfg.permissoes}`,
      ),
    );
    this.log(cor.cinza(`Pasta: ${this.debate.pasta}`));
    if (e.turnos.length) this.log(cor.cinza(`Retomando: ${e.turnos.length} turno(s) já gravado(s).`));
    if (this.ui.interativo) this.mostrarAjuda();
    else this.log(cor.cinza('De outro terminal: revezar responder "…" · revezar pausar · revezar parar'));
    if (e.status === 'aguardando_humano' && e.pergunta) this.mostrarPergunta();
  }

  mostrarAjuda() {
    this.log(cor.cinza('Você pode digitar aqui a qualquer momento:'));
    this.log(cor.cinza('  texto + Enter    sua fala; as IAs leem antes do próximo turno'));
    this.log(cor.cinza('  @arquivo.md      manda o conteúdo de um arquivo como fala'));
    this.log(cor.cinza('  /pausar  /retomar  /parar  /parar agora  /status  /ajuda'));
  }

  mostrarPergunta() {
    const p = this.estado.pergunta;
    this.log('');
    this.log(cor.magenta(cor.negrito(`❓ ${nomeDoAgente(p.autor)} precisa de você (turno ${p.turno}):`)));
    for (const linha of p.texto.split('\n')) this.log(`   ${linha}`);
    this.log('');
    this.log(
      cor.magenta(
        this.ui.interativo
          ? 'Digite sua resposta e tecle Enter (texto longo: @arquivo.md).'
          : 'Responda com: revezar responder "sua resposta"',
      ),
    );
  }

  log(texto) {
    this.ui.escrever(texto);
    try {
      fs.appendFileSync(path.join(pastaInterna(this.debate.pasta), 'log.txt'), `[${dataHoraLocal()}] ${semCor(texto)}\n`);
    } catch {}
  }

  avisar(titulo, mensagem) {
    if (!this.cfg.notificar || this.opcoes.notificar === false) return;
    if (process.stdout.isTTY) process.stdout.write('\x07');
    notificar(`Revezamento · ${titulo}`, mensagem);
  }

  salvar() {
    salvarEstado(this.debate.pasta, this.estado);
  }

  async esperar(condicao) {
    while (!condicao()) await dormir(this.opcoes.intervaloEsperaMs);
  }
}

function removerSeVazia(pasta) {
  try {
    if (!fs.readdirSync(pasta).length) {
      fs.rmdirSync(pasta);
      const mae = path.dirname(pasta);
      if (!fs.readdirSync(mae).length) fs.rmdirSync(mae);
    }
  } catch {}
}
