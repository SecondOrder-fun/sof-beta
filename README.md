# SecondOrder.fun (sof-beta)

Web3 platform transforming memecoins into structured, fair finite games using game theory, with InfoFi prediction markets.

## Monorepo Structure

```
packages/
  frontend/    React + Vite SPA
  backend/     Fastify API server
  contracts/   Foundry / Solidity smart contracts
docs/          Documentation (submodule)
scripts/       Deploy and utility scripts
instructions/  Project instructions and specs
```

## Tech Stack

| Layer      | Stack                        |
|------------|------------------------------|
| Frontend   | React, Vite, TypeScript      |
| Backend    | Fastify, TypeScript          |
| Contracts  | Solidity, Foundry            |
| Monorepo   | Turborepo, pnpm              |
| Chain      | Base L2                      |
| Deploy     | Vercel (frontend), Railway (backend) |

## Quick Start

```bash
pnpm install
pnpm dev
```

## License

Unlicensed -- All rights reserved.
