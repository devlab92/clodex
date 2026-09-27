# Exemplos

Debates prontos para copiar para o seu projeto. Cada pasta tem um `revezamento.json` e uma `00-pauta.md` já preenchida.

| Exemplo | Mostra |
|---|---|
| [telas-de-compra/](telas-de-compra/) | Debate de produto, modo `perguntar` (padrão): as IAs te consultam no que é escolha sua |
| [escolher-biblioteca/](escolher-biblioteca/) | Decisão técnica, modo `decidir`, 2 ciclos: elas decidem e registram o que decidiram |
| [mockups-com-anexos/](mockups-com-anexos/) | Modo `escrita`: cada IA pode criar arquivos (mockups) na própria pasta de anexos |

**Como usar um exemplo:**

```powershell
# copie a pasta para dentro do seu projeto
Copy-Item -Recurse exemplos\telas-de-compra C:\caminho\do\projeto\alinhamento\2026-09-28-telas

# ajuste a pauta (caminhos de arquivos, o que já está decidido) e rode
cd C:\caminho\do\projeto
revezar iniciar alinhamento\2026-09-28-telas
```
