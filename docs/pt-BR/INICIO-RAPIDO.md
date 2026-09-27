# Início rápido

🇺🇸 [Read in English](../QUICKSTART.md)

Em 5 minutos você coloca o **Claude** e o **Codex** para debaterem sozinhos. Você escreve o assunto, elas conversam em turnos, e no fim você recebe um relatório com o que ficou combinado e o que precisa da sua decisão.

Você não precisa mais ficar trocando de janela e colando a resposta de uma na outra.

![Como o Clodex funciona](../img/flow.pt-BR.svg)

---

## Passo 0 · Instalar (só uma vez)

Abra um terminal (no VS Code: **Terminal → Novo Terminal**) e rode:

```bash
cd caminho/do/clodex
npm link
clodex doctor
```

Deve aparecer:

```text
✔ Node 22.20.0
✔ Claude: 2.1.283 (Claude Code)
✔ Codex: codex-cli 0.155.0
All set.
```

> Não precisa instalar nada além disso. O Clodex usa o Claude Code e o Codex que já estão no seu computador (ele os encontra até dentro das extensões do VS Code), com as mesmas contas e assinaturas.

> O terminal do Clodex fala inglês. O debate em si (o que as IAs escrevem) segue a configuração `language`.

---

## Passo 1 · Criar o debate

Entre na pasta do projeto e crie o debate:

```bash
cd caminho/do/seu-projeto
clodex new debates/2026-09-28-checkout --topic "Fluxo de compra no celular" --language pt-BR
```

Isso cria uma pasta com dois arquivos:

```text
debates/2026-09-28-checkout/
├── clodex.json    ← as regras do debate (ciclos, autonomia, idioma...)
└── 00-brief.md    ← a pauta: o que você quer que elas debatam
```

> Sem `--language`, o idioma do debate segue o idioma do seu sistema.

---

## Passo 2 · Escrever a pauta

Abra o `00-brief.md`, **apague a primeira linha** (o comentário `<!-- clodex:fill-in... -->`) e escreva o que quer. Exemplo:

```markdown
# Pauta: Fluxo de compra no celular

## O que eu quero decidir
A melhor sequência de telas para comprar no celular:
quantas etapas, o que aparece em cada uma e onde entra o pagamento.

## Contexto e arquivos para ler
- `docs/decisions.md`: o que já está decidido
- `debates/2026-09-20-identidade-visual/`: o debate anterior

## O que já está decidido (não rediscutir)
- A identidade visual.
- Cartão e transferência instantânea são as formas de pagamento.

## Como quero a resposta
Uma sequência única de telas, com o motivo de cada escolha.
```

> **Dica:** quanto mais clara a pauta, mais curto e útil o debate. Diga o que **não** é para rediscutir.

---

## Passo 3 · Iniciar

```bash
clodex start debates/2026-09-28-checkout
```

E é só acompanhar. O terminal mostra cada turno começando e terminando:

![Exemplo do terminal durante um debate](../img/terminal.svg)

Cada turno vira um arquivo na pasta, na ordem:

```text
debates/2026-09-28-checkout/
├── 00-brief.md
├── 01-claude.md     ← proposta do Claude
├── 02-codex.md      ← resposta do Codex
├── 03-alex.md       ← sua resposta a uma pergunta
├── 04-claude.md
├── ...
└── 08-report.md     ← o relatório final
```

> ⏱️ Cada turno leva alguns minutos, porque a IA lê o projeto antes de responder. Um aviso aparece a cada minuto para você saber que ela está trabalhando. Pode deixar rodando e fazer outra coisa: quando precisar de você, **o sistema mostra uma notificação**.

---

## Passo 4 · Participar enquanto roda

Você participa **digitando no mesmo terminal**, a qualquer momento:

| Quero... | Digito no terminal do debate |
|---|---|
| Responder a uma pergunta | a resposta + **Enter** |
| Dar um palpite no meio do debate | o texto + **Enter** (entra antes do próximo turno) |
| Mandar um texto grande | salvo num arquivo e digito `@minha-resposta.md` |
| Pausar | `/pause` (espera o turno atual terminar) |
| Continuar depois da pausa | `/resume` |
| Parar | `/stop` (espera o turno atual) ou `/stop now` |
| Ver em que pé está | `/status` |

**Quando uma IA pergunta**, o debate para e espera por você:

```text
❓ Codex needs you (turn 2):
   1. A compra expressa vem antes do formulário completo? Opções: sim / não. Recomendo: sim.

Type your answer and press Enter (long text: @file.md).
you › Sim, expressa primeiro. O formulário completo fica como segunda opção.
✉ Answer received. The debate continues.
```

Sua resposta vira um turno (`03-alex.md`) e as duas IAs a leem.

<details>
<summary><b>Prefere usar outro terminal?</b> (clique para ver)</summary>

Os mesmos comandos funcionam de qualquer terminal, até de outra pasta. O Clodex lembra do último debate usado:

```bash
clodex status
clodex reply "Sim, expressa primeiro."
clodex reply @minha-resposta.md
clodex pause
clodex resume
clodex stop
clodex stop --now
```

</details>

---

## Passo 5 · Ler o relatório

Quando as IAs concordam (**consenso**) ou chegam ao limite de ciclos, o **Claude escreve o relatório** como relator neutro, e o **Codex confere** se as posições dele foram bem representadas. O relatório sempre tem estas partes:

| Seção | O que tem |
|---|---|
| **Resultado em uma frase** | a conclusão |
| **O que ficou combinado** | tabela com cada ponto, quem propôs e em qual turno |
| **Divergências que sobraram** | a posição de cada IA e a recomendação |
| **Decisões que as IAs tomaram por você** | só no modo `decide`, para você conferir |
| **Preciso que você decida** | a lista numerada do que é seu |
| **Próximos passos** | o que fazer depois |
| **Conferência do Codex** | "confere" ou as correções dele |

---

## Passo 6 · Depois do relatório

- **Concordou com tudo?** Acabou. Os arquivos ficam na pasta como registro.
- **Quer que elas continuem com as suas decisões?** Responda aos itens do "Preciso que você decida" e rode mais uma rodada:

```bash
clodex continue --more 1 --message "1: sim. 2: opção B. 3: deixa para depois."
```

Isso roda **mais 1 ciclo** (cada IA fala mais uma vez) e gera um relatório novo.

---

## Receitas de configuração

Tudo fica no `clodex.json` da pasta do debate. Mude só o que precisar:

**Quero ser consultado sempre** (padrão)
```json
{ "autonomy": "ask" }
```

**Decidam vocês e me tragam o resultado**
```json
{ "autonomy": "decide" }
```
> Mesmo assim elas param se algo for de segurança, jurídico, dinheiro ou irreversível, e nunca aprovam planos no seu lugar.

**Debate curto** (1 ciclo = cada IA fala uma vez)
```json
{ "max_cycles": 1 }
```

**O Codex começa**
```json
{ "participants": ["codex", "claude"] }
```

**Debate em português** (o terminal continua em inglês)
```json
{ "language": "pt-BR" }
```

**Elas precisam criar arquivos** (mockups, exemplos)
```json
{ "permissions": "write" }
```
> Cada IA só consegue gravar na própria pasta `attachments/NN-nome/` dentro do debate. O resto do projeto continua só leitura.

**Sem relatório no fim**
```json
{ "reporter": null }
```

**Regras extras para as duas**
```json
{ "extra_instructions": "Respostas curtas. Sempre compare com o fluxo atual descrito em docs/flow.md." }
```

A lista completa está no [MANUAL, §5](MANUAL.md#5-configuração-completa).

---

## Cola rápida

| Comando | Para quê |
|---|---|
| `clodex new <pasta> --topic "..."` | criar um debate |
| `clodex start [pasta]` | começar, ou continuar de onde parou |
| `clodex status` | ver a situação |
| `clodex reply "..."` | responder ou comentar (aceita `@arquivo.md`) |
| `clodex pause` / `resume` | pausar e continuar |
| `clodex stop [--now]` | parar |
| `clodex continue --more 1 --message "..."` | mais uma rodada depois do relatório |
| `clodex report` | gerar o relatório agora, com o que houver |
| `clodex doctor` | conferir a instalação |

---

## Problemas comuns

| O que aparece | O que fazer |
|---|---|
| `clodex` não é reconhecido | Rode o Passo 0 de novo (`npm link` na pasta do clodex). Alternativa: `node caminho/do/clodex/bin/clodex.mjs ...` |
| `✖ Claude: not found` ou `✖ Codex: not found` | Confira se a extensão está instalada no VS Code. Se estiver em outro lugar, veja o [MANUAL, §12](MANUAL.md#12-onde-o-clodex-procura-o-claude-e-o-codex) |
| "The brief is still the blank template" | Apague a primeira linha do `00-brief.md` |
| "An orchestrator is already running this debate" | Outro terminal está com esse debate aberto. Use `clodex status` ou `clodex stop` |
| "✖ Turn 3 (Codex): ..." e o debate parou | Normalmente é limite de uso ou internet. Espere e digite `/resume` (ou `clodex resume`) |
| Fechei o terminal sem querer | Rode `clodex start` de novo: continua do último turno completo |
| O Codex diz "Acesso negado" ou não acha arquivos (Windows) | Deixe o debate numa pasta comum (Documentos, pasta do projeto), nunca em pastas temporárias do Windows (`AppData\Local\Temp`). Veja o [MANUAL, §14](MANUAL.md#14-solução-de-problemas) |
| Quero ver exatamente o que a IA recebeu | Abra `.clodex/prompts/` dentro da pasta do debate |

Mais detalhes: [MANUAL.md](MANUAL.md).
