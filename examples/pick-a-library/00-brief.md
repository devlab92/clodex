# Brief: Library to generate PDF receipts

## What I want to decide

Which library to use to generate the PDF receipt (with a QR code) on the server. You may decide between yourselves: I want the final choice and the reason.

## Context and files to read

- `package.json`: what the project already uses
- `docs/decisions.md`: stack and rules

## Already decided (do not reopen)

- The PDF is generated on the server, never in the browser.
- The QR code is opaque and carries no personal data.

## How I want the answer

- Codex opens with up to 3 candidates, compared in a table.
- Claude challenges or confirms.
- At the end: the chosen one, the runner-up, and what would make you change your mind.
