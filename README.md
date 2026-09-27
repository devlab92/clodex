# revezamento-ia

**Faz o Claude Code e o Codex debaterem sozinhos, em turnos, e te entrega um relatório.**

Chega de trocar de janela e colar a resposta de uma IA na outra. Você escreve a pauta, o `revezar` passa a vez entre as IAs, para quando uma delas precisa de você e, no fim, o Claude escreve o relatório e o Codex confere.

![Como o revezamento funciona](docs/img/fluxo.svg)

## Em 30 segundos

```powershell
# uma vez só
cd revezamento-ia
npm link
revezar diagnostico

# em qualquer projeto
revezar novo alinhamento/2026-09-28-telas --tema "Telas de compra no celular"
#   → escreva a pauta em alinhamento/2026-09-28-telas/00-pauta.md
revezar iniciar alinhamento/2026-09-28-telas
```

Durante o debate, você digita no mesmo terminal: uma frase vira sua fala; `/pausar`, `/retomar` e `/parar` controlam o debate.

![Exemplo do terminal](docs/img/terminal.svg)

## O que ele faz

- **Revezamento automático.** Claude → Codex → Claude…, cada um lendo tudo o que veio antes. O fim do turno de uma IA dispara o turno da outra.
- **Limite de ciclos**, configurável (padrão: 3).
- **Autonomia configurável.** `perguntar`: a IA para e te consulta. `decidir`: elas decidem e registram o que decidiram por você.
- **Pausa para você.** Quando uma IA pergunta, você recebe uma notificação do Windows e responde no terminal.
- **Controle total.** Pausar, retomar, parar ao fim do turno ou parar na hora; fechar o terminal e retomar depois.
- **Relatório com conferência.** O relator neutro escreve o combinado, as divergências e o "Preciso que você decida", e a outra IA confere se foi bem representada.
- **Tudo em arquivos Markdown** numerados, na pasta do debate, prontos para versionar.
- **Seguro por padrão.** Modo só leitura, sem pular permissões, sem commit. As regras do projeto (`AGENTS.md`, `CLAUDE.md`) continuam valendo.
- **Sem dependências.** Só Node 22+ e o Claude Code e o Codex que você já usa. Ele os encontra até dentro das extensões do VS Code.

## Documentação

| Documento | Para quê |
|---|---|
| [docs/COMO-USAR.md](docs/COMO-USAR.md) | **Guia rápido e didático**, passo a passo, com exemplos e receitas |
| [docs/MANUAL.md](docs/MANUAL.md) | **Referência completa**: protocolo, configuração, comandos, estados, segurança, limites, como estender |
| [exemplos/](exemplos/) | Debates prontos para copiar |

## Requisitos

- Node.js 22 ou mais novo
- Claude Code (CLI ou extensão do VS Code), com login feito
- Codex (CLI ou extensão do VS Code), com login feito
- Testado no Windows 11. macOS e Linux estão previstos, mas ainda não foram testados.

## Desenvolvimento

```powershell
npm test
```

Os testes trocam as IAs por um agente falso que imita as saídas do Claude e do Codex, então rodam em segundos e sem gastar uso. Veja o [MANUAL, §16](docs/MANUAL.md#16-desenvolvimento-e-testes).
