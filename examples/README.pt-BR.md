# Exemplos

🇺🇸 [Read in English](README.md)

Debates prontos para copiar para o seu projeto. Cada pasta tem um `clodex.json` e um `00-brief.md` (a pauta) já preenchido. Os exemplos estão em inglês; para um debate em português, mude `"language"` para `"pt-BR"` e escreva a pauta em português.

| Exemplo | Mostra |
|---|---|
| [checkout-flow/](checkout-flow/) | Debate de produto, modo `ask` (padrão): as IAs te consultam no que é escolha sua |
| [pick-a-library/](pick-a-library/) | Decisão técnica, modo `decide`, 2 ciclos, o Codex abre: elas decidem e registram o que decidiram |
| [mockups-with-attachments/](mockups-with-attachments/) | Modo `write`: cada IA pode criar arquivos (mockups) na própria pasta de anexos |

**Como usar um exemplo:**

```bash
# copie a pasta para dentro do seu projeto
cp -r examples/checkout-flow caminho/do/seu-projeto/debates/2026-09-28-checkout

# ajuste a pauta (caminhos de arquivos, o que já está decidido), o "human" e o "language", e rode
cd caminho/do/seu-projeto
clodex start debates/2026-09-28-checkout
```

No PowerShell do Windows, copie com `Copy-Item -Recurse examples\checkout-flow caminho\do\seu-projeto\debates\2026-09-28-checkout`.
