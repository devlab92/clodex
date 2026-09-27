import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AGENTES } from './agentes/index.mjs';
import { ARQUIVO_PAUTA, carregarDebate, criarDebate, ehPastaDeDebate } from './config.mjs';
import { cor } from './console.mjs';
import { enviarParaCaixa, lerEstado, lerUltimo, maestroAtivo, registrarUltimo } from './estado.mjs';
import { continuar, gerarRelatorio, iniciar } from './maestro.mjs';
import { descreverStatus } from './status.mjs';
import { ErroAmigavel, resolverTexto } from './util.mjs';

const AJUDA = `${cor.negrito('revezar')}: faz duas IAs debaterem em turnos, sozinhas, e te entrega um relatório.

${cor.negrito('Uso básico')}
  revezar novo <pasta> --tema "..."     cria o debate (config + pauta em branco)
  revezar iniciar [pasta]               começa ou retoma o debate neste terminal
  revezar status [pasta]                mostra em que pé está

${cor.negrito('Participar enquanto roda')} (ou digite direto no terminal do maestro)
  revezar responder [pasta] "texto"     responde a uma pergunta ou comenta (aceita @arquivo.md)
  revezar pausar [pasta]                pausa ao fim do turno atual
  revezar retomar [pasta]               continua depois de pausa ou erro
  revezar parar [pasta] [--agora]       para ao fim do turno (ou já, com --agora)

${cor.negrito('Depois do fim')}
  revezar continuar [pasta] [--mais N] [--mensagem "..."]   mais N ciclos (padrão 1)
  revezar relatorio [pasta]             gera o relatório agora

${cor.negrito('Outros')}
  revezar diagnostico                   confere se Claude e Codex foram encontrados
  revezar ajuda

Opções do "novo": --tema, --ciclos N, --autonomia perguntar|decidir, --humano Nome, --permissoes leitura|escrita

Sem [pasta], usa a pasta atual (se for um debate) ou o último debate usado.
Guia: docs/COMO-USAR.md · Referência: docs/MANUAL.md`;

const OPCOES_SEM_VALOR = new Set(['agora', 'ajuda', 'help', 'h']);

export function analisarArgs(argv) {
  const posicionais = [];
  const opcoes = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') || (arg.startsWith('-') && arg.length === 2)) {
      const [chave, valor] = arg.replace(/^--?/, '').split(/=(.*)/s, 2);
      if (valor !== undefined) opcoes[chave] = valor;
      else if (!OPCOES_SEM_VALOR.has(chave) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) opcoes[chave] = argv[++i];
      else opcoes[chave] = true;
    } else {
      posicionais.push(arg);
    }
  }
  return { posicionais, opcoes };
}

/** Pasta explícita (1º argumento) → pasta atual → último debate usado. */
export function resolverPasta(posicionais, explicita) {
  if (explicita) {
    if (!ehPastaDeDebate(explicita)) throw new ErroAmigavel(`${path.resolve(explicita)} não é uma pasta de debate.`);
    return path.resolve(explicita);
  }
  if (posicionais.length && ehPastaDeDebate(posicionais[0])) return path.resolve(posicionais.shift());
  if (ehPastaDeDebate(process.cwd())) return process.cwd();
  const ultimo = lerUltimo();
  if (ultimo && ehPastaDeDebate(ultimo)) return ultimo;
  throw new ErroAmigavel('Não achei a pasta do debate. Passe o caminho (ex.: revezar status alinhamento/meu-debate) ou rode de dentro dela.');
}

function avisarAlvo(pasta) {
  if (path.resolve(pasta) !== process.cwd()) console.log(cor.cinza(`→ debate: ${pasta}`));
}

export async function principal(argv) {
  const [comando = 'ajuda', ...resto] = argv;
  const { posicionais, opcoes } = analisarArgs(resto);
  if (opcoes.ajuda || opcoes.help || opcoes.h) {
    console.log(AJUDA);
    return 0;
  }

  switch (comando) {
    case 'novo': {
      const destino = posicionais[0];
      if (!destino) throw new ErroAmigavel('Diga onde criar: revezar novo <pasta> --tema "..."');
      const { pasta, cfg } = criarDebate(destino, {
        tema: opcoes.tema,
        ciclos: opcoes.ciclos,
        autonomia: opcoes.autonomia,
        humano: opcoes.humano,
        permissoes: opcoes.permissoes,
      });
      registrarUltimo(pasta);
      console.log(`${cor.verde('✔')} Debate criado em ${pasta}`);
      console.log(`  ${cor.negrito('1.')} Escreva a pauta: ${path.join(pasta, ARQUIVO_PAUTA)}`);
      console.log(`  ${cor.negrito('2.')} Ajuste, se quiser: ${path.join(pasta, 'revezamento.json')} (ciclos: ${cfg.max_ciclos}, autonomia: ${cfg.autonomia})`);
      console.log(`  ${cor.negrito('3.')} Rode: ${cor.negrito(`revezar iniciar "${path.relative(process.cwd(), pasta) || '.'}"`)}`);
      return 0;
    }

    case 'iniciar':
    case 'comecar':
    case 'começar': {
      const pasta = resolverPasta(posicionais, opcoes.pasta);
      await iniciar(pasta);
      return 0;
    }

    case 'retomar': {
      const pasta = resolverPasta(posicionais, opcoes.pasta);
      if (maestroAtivo(pasta)) {
        enviarParaCaixa(pasta, { tipo: 'retomar' });
        avisarAlvo(pasta);
        console.log('Pedido de retomar entregue ao maestro.');
        return 0;
      }
      await iniciar(pasta);
      return 0;
    }

    case 'continuar': {
      const pasta = resolverPasta(posicionais, opcoes.pasta);
      if (maestroAtivo(pasta)) throw new ErroAmigavel('O maestro ainda está rodando neste debate. Use "revezar responder" para falar com ele.');
      await continuar(pasta, { mais: opcoes.mais ?? 1, mensagem: opcoes.mensagem ?? (posicionais.join(' ') || undefined) });
      return 0;
    }

    case 'relatorio':
    case 'relatório': {
      const pasta = resolverPasta(posicionais, opcoes.pasta);
      if (maestroAtivo(pasta)) throw new ErroAmigavel('O maestro ainda está rodando. Pare-o antes (revezar parar) ou espere o fim.');
      await gerarRelatorio(pasta);
      return 0;
    }

    case 'responder':
    case 'comentar':
    case 'falar': {
      const pasta = resolverPasta(posicionais, opcoes.pasta);
      const texto = resolverTexto(opcoes.mensagem ?? posicionais.join(' '));
      if (!texto) throw new ErroAmigavel('Escreva a resposta: revezar responder "sua resposta" (ou @arquivo.md)');
      enviarParaCaixa(pasta, { tipo: 'fala', texto });
      avisarAlvo(pasta);
      if (maestroAtivo(pasta)) console.log(`${cor.verde('✔')} Entregue ao maestro.`);
      else console.log(`${cor.verde('✔')} Guardado. O maestro não está rodando: rode ${cor.negrito('revezar iniciar')} para continuar o debate.`);
      return 0;
    }

    case 'pausar':
    case 'parar': {
      const pasta = resolverPasta(posicionais, opcoes.pasta);
      avisarAlvo(pasta);
      if (!maestroAtivo(pasta)) {
        console.log('Nenhum maestro rodando neste debate. Nada a fazer.');
        return 0;
      }
      const tipo = comando === 'parar' && opcoes.agora ? 'parar_agora' : comando;
      enviarParaCaixa(pasta, { tipo });
      console.log(
        {
          pausar: 'Pedido entregue: o maestro pausa ao fim do turno atual.',
          parar: 'Pedido entregue: o maestro para ao fim do turno atual.',
          parar_agora: 'Pedido entregue: o maestro interrompe a IA agora.',
        }[tipo],
      );
      return 0;
    }

    case 'status': {
      const pasta = resolverPasta(posicionais, opcoes.pasta);
      const debate = carregarDebate(pasta);
      console.log(descreverStatus(debate, lerEstado(pasta), { ativo: maestroAtivo(pasta) }));
      return 0;
    }

    case 'diagnostico':
    case 'diagnóstico':
      return diagnostico();

    case 'ajuda':
    case 'help':
      console.log(AJUDA);
      return 0;

    default:
      throw new ErroAmigavel(`Comando desconhecido: ${comando}. Veja: revezar ajuda`);
  }
}

function diagnostico() {
  let tudoCerto = true;
  const [maior] = process.versions.node.split('.').map(Number);
  console.log(`${maior >= 22 ? cor.verde('✔') : cor.vermelho('✖')} Node ${process.versions.node}${maior >= 22 ? '' : ' (precisa ≥ 22)'}`);
  if (maior < 22) tudoCerto = false;
  for (const adaptador of Object.values(AGENTES)) {
    const achado = adaptador.localizar();
    if (!achado) {
      tudoCerto = false;
      console.log(`${cor.vermelho('✖')} ${adaptador.nome}: não encontrado. ${adaptador.comoInstalar}`);
      continue;
    }
    const precisaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(achado.caminho);
    const v = spawnSync(precisaShell ? `"${achado.caminho}" --version` : achado.caminho, precisaShell ? [] : ['--version'], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
      shell: precisaShell,
    });
    const versao = (v.stdout || v.stderr || '').trim().split(/\r?\n/)[0];
    const ok = v.status === 0;
    if (!ok) tudoCerto = false;
    console.log(`${ok ? cor.verde('✔') : cor.vermelho('✖')} ${adaptador.nome}: ${versao || 'não respondeu a --version'}`);
    console.log(cor.cinza(`    ${achado.caminho}  (${achado.origem})`));
  }
  const ultimo = lerUltimo();
  if (ultimo && fs.existsSync(ultimo)) console.log(cor.cinza(`Último debate usado: ${ultimo}`));
  console.log(tudoCerto ? cor.verde('Tudo pronto.') : cor.amarelo('Resolva os itens marcados com ✖ antes de iniciar um debate.'));
  return tudoCerto ? 0 : 1;
}
