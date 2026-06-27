# Contributing

Dvar changes must preserve deterministic enforcement, explicit failure behavior, privacy-safe defaults, and the source-of-truth product boundary.

## Development

```bash
npm install
npm run check
```

A pull request should include tests for policy precedence and failure behavior, update documentation for public contracts, and update `docs/source-of-truth.md` when a locked product decision changes.

Do not add model calls or network dependencies to the ordinary synchronous decision path. Do not execute policy as JavaScript or TypeScript. Do not log raw credentials, authorization headers, prompts, arguments, or tool output by default.
