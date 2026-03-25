# SecondOrder.fun Frontend Guidelines

## Technology Stack

- **React 18** with functional components and hooks
- **Vite 6** for development and builds
- **Tailwind CSS** for utility-first styling
- **shadcn/ui** for consistent, accessible components (built on **Radix UI**)
- **framer-motion** for complex animations (use with Motion Primitives patterns for Radix)
- **React Query** for server state management
- **Wagmi + Viem** for Ethereum interactions
- **Farcaster Auth Kit** for social authentication

## Internationalization (i18n)

All user-facing text must use the i18n system via `react-i18next`. Never hardcode strings in components.

```jsx
// CORRECT
import { useTranslation } from 'react-i18next';
const Component = () => {
  const { t } = useTranslation('namespace');
  return <div>{t('key')}</div>;
};

// WRONG — hardcoded strings
const Component = () => <div>Hello</div>;
```

### Translation File Organization

Translation files live in `public/locales/{lang}/`:
- `common.json` — shared UI elements (buttons, labels)
- `raffle.json` — raffle-specific text
- `market.json` — prediction market text
- `admin.json` — admin panel text
- `errors.json` — error messages
- `navigation.json` — navigation items

### Hooks and i18n

Hooks return data; components handle all text rendering and translation. Never generate user-facing text inside hooks.

```jsx
// CORRECT — hook returns data
export const useMarketData = (marketId) => {
  return { market: { type: 'WINNER_PREDICTION', count: 5, status: 'active' } };
};
// Component handles translation
const MarketDisplay = () => {
  const { t } = useTranslation('market');
  const { market } = useMarketData(marketId);
  return <div>{t('winnerPredictionCount', { count: market.count })}</div>;
};

// WRONG — hook generates text
export const useMarketData = (marketId) => {
  return { market: { title: 'Winner Prediction (5)' } };
};
```

## Component Standards

### Functional Components Only

No class components. No React import needed (Vite handles JSX transform).

```jsx
import { useState } from "react";
import PropTypes from "prop-types";
```

### Naming Conventions

- **PascalCase** for component names and files
- **camelCase** for props and variables
- **kebab-case** for CSS classes
- Descriptive names that indicate purpose (e.g., `RaffleParticipationForm`, not `Form`)

### Custom Hooks

- Always prefix with `use`
- Return raw data and state, not formatted text
- Use React Query for server state with proper query keys

## Theming (Critical)

### Never Hardcode Colors

All colors MUST use CSS variables via semantic Tailwind classes. CSS variables are defined in `packages/frontend/src/styles/tailwind.css` — this is the ONLY place colors should be defined.

```jsx
// WRONG
className="text-[#c82a54] bg-[#f9d6de] border-[#130013]"

// CORRECT
className="text-primary bg-muted border-foreground"
```

### Color Palette

| Hex | Token | Tailwind Class |
|-----|-------|---------------|
| `#c82a54` (Cochineal Red) | `--primary` | `bg-primary`, `text-primary`, `border-primary` |
| `#e25167` (Fabric Red) | — | `bg-primary/80`, `hover:bg-primary/80` |
| `#a89e99` (Cement) | `--muted-foreground` | `text-muted-foreground` |
| `#130013` (Black) | `--background` | `bg-background` |
| `#f9d6de` (Pastel Rose) | `--muted` | `bg-muted` |
| `#353e34` (Asphalt) | `--foreground` | `text-foreground` |
| `#1a1a1a` | `--card` | `bg-card` |

### Rules

1. **No inline `style={{}}` overrides** on UI components. Add variants to base components instead.
2. **No hardcoded hex in Tailwind brackets** — use `bg-primary` not `bg-[#c82a54]`.
3. **No `text-white` / `bg-black`** — use `text-foreground` / `bg-background`. Use `text-primary-foreground` for text on colored backgrounds.
4. **No `dark:` prefix scattering** — theme switching is handled by CSS variables in `:root` / `.dark`.
5. **External brand colors** (Farcaster `#7c3aed`, Base `#0052ff`) are acceptable only as dedicated Button variants (`variant="farcaster"`, `variant="base"`).
6. **Recharts/SVG** — inline `style` props for SVG attributes (fontSize, stroke) are acceptable.

### Button Variants

| Variant | Use Case |
|---------|----------|
| `default` / `primary` | Main CTA |
| `secondary` | Secondary actions |
| `outline` | Bordered, transparent bg |
| `cancel` | Cancel/dismiss |
| `ghost` | Minimal, no background |
| `link` | Inline text links |
| `destructive` / `danger` | Delete/error actions |
| `farcaster` | Farcaster brand purple |
| `base` | Base/Coinbase brand blue |

Use `asChild` to render Button as an anchor or other element.

### Pointer-Event Pressed State (Mobile/Farcaster)

CSS `:active` pseudo-class MUST NOT be used on buttons. On mobile browsers and Farcaster frames, `:active` can become "stuck." Use pointer events + `data-pressed` attribute instead.

```jsx
// WRONG — :active gets stuck on touch UIs
className="bg-primary active:bg-primary/60"

// CORRECT — pointer-event driven
className="bg-primary data-[pressed]:bg-primary/60"
```

Never add `active:` Tailwind prefixes to any Button variant. Always use `data-[pressed]:`.

## UI Component System (Radix + shadcn/ui)

Adopted Radix primitives under `packages/frontend/src/components/ui/`:
- Dialog, Label, Toast, Dropdown Menu, Select, Popover, Tooltip, Sheet, Accordion, Tabs, Collapsible, Avatar, Progress, Switch

### Guidelines

- **Prefer Radix** for overlays and complex a11y (dialog, popover, tooltip, dropdown-menu, select, toast, sheet, navigation-menu, context-menu)
- **Keep exports stable** — wrap Radix primitives in shadcn-style components with Tailwind classes
- **Styling**: Tailwind utilities + `cn` helper; no inline styles
- **Animation**: `tailwindcss-animate` for simple transitions; framer-motion for entrance/exit/layout animations. CSS transitions for hover/active states.

### Component Variants with CVA

Use `class-variance-authority` for component variants:

```jsx
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  { variants: { variant: { default: "bg-primary text-primary-foreground" } } }
);
```

## State Management

- **React Query** for server state (blockchain data, API responses)
- **React Context** for global app state (auth, theme, SSE)
- **Local useState/useReducer** for component-level state
- **Custom hooks** for shared stateful logic

### React Query Patterns

```jsx
export const raffleKeys = {
  all: ["raffles"],
  lists: () => [...raffleKeys.all, "list"],
  detail: (id) => [...raffleKeys.all, "detail", id],
};
```

## Responsive Design

Mobile-first approach. Use Tailwind responsive prefixes (`md:`, `lg:`).

```jsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
```

## On-Chain Transactions (Critical)

ALL on-chain operations MUST use the ERC-5792 batched transaction flow via `useSmartTransactions.executeBatch`. Never use raw `writeContractAsync` for user-facing transactions. See `instructions/project-requirements.md` for the three-tier fallback details.
