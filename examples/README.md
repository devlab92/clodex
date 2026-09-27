# Examples

🇧🇷 [Leia em português](README.pt-BR.md)

Ready-made debates to copy into your project. Each folder has a `clodex.json` and a filled-in `00-brief.md`.

| Example | Shows |
|---|---|
| [checkout-flow/](checkout-flow/) | Product debate, `ask` mode (default): the AIs consult you on what is your call |
| [pick-a-library/](pick-a-library/) | Technical decision, `decide` mode, 2 cycles, Codex opens: they decide and record what they decided |
| [mockups-with-attachments/](mockups-with-attachments/) | `write` mode: each AI may create files (mockups) in its own attachments folder |

**How to use an example:**

```bash
# copy the folder into your project
cp -r examples/checkout-flow path/to/your-project/debates/2026-09-28-checkout

# adjust the brief (file paths, what is already decided), the "human" and the "language", then run
cd path/to/your-project
clodex start debates/2026-09-28-checkout
```

On Windows PowerShell, copy with `Copy-Item -Recurse examples\checkout-flow path\to\your-project\debates\2026-09-28-checkout`.
