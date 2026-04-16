# SecondOrder.fun Frontend Guidelines

## Overview

This document outlines the development standards, patterns, and best practices for SecondOrder.fun's frontend application. Following these guidelines ensures consistency, maintainability, and optimal performance across the platform.

## Technology Stack & Architecture

### Core Framework

- **React 18** with functional components and hooks
- **Vite 6** for fast development and optimized builds
- **TypeScript/JavaScript** with JSDoc for type annotations
- **Tailwind CSS** for utility-first styling
- **shadcn/ui** for consistent, accessible components (built on **Radix UI**)
- **Radix UI primitives** adopted for headless a11y and focus management

### State Management

- **React Query** for server state management and caching
- **React Context** for global application state
- **Local useState/useReducer** for component-level state
- **Custom hooks** for shared stateful logic

### Web3 Integration

- **Wagmi + Viem** for Ethereum interactions
- **RainbowKit** for wallet connections
- **Farcaster Auth Kit** for social authentication
- **React Query** for blockchain data caching

## File Structure & Organization

### Component Organization

```bash
src/components/
├── ui/              # Base shadcn/ui components
├── common/          # Shared application components
├── features/        # Feature-specific components
├── layout/          # Layout and navigation components
└── sandbox/         # Development and testing components
```

### Feature-Based Structure

```bash
src/features/raffle/
├── components/      # Raffle-specific components
├── hooks/          # Raffle-related custom hooks
├── services/       # Raffle business logic
├── types/          # Raffle type definitions
└── utils/          # Raffle utility functions
```

## Internationalization (i18n)

### Translation Guidelines

All user-facing text must use the i18n system via `react-i18next`. Never hardcode English or any language strings in components.

```jsx
// ✅ Good - Using translation
import { useTranslation } from 'react-i18next';

const RaffleCard = ({ raffle }) => {
  const { t } = useTranslation('raffle');
  
  return (
    <div>
      <h2>{t('title')}</h2>
      <p>{t('activeSeasons')}</p>
      <button>{t('open')}</button>
    </div>
  );
};

// ❌ Bad - Hardcoded strings
const RaffleCard = ({ raffle }) => {
  return (
    <div>
      <h2>Raffles</h2>
      <p>Active Seasons</p>
      <button>Open</button>
    </div>
  );
};
```

### Translation Keys Organization

Translation files are organized by feature in `/public/locales/{lang}/`:

- `common.json` - Shared UI elements (buttons, labels, etc.)
- `raffle.json` - Raffle-specific text
- `market.json` - Prediction market text
- `admin.json` - Admin panel text
- `errors.json` - Error messages
- `navigation.json` - Navigation items

### Hooks and i18n

**Hooks should NOT contain translation logic or generate user-facing text.** Hooks return data; components handle all text rendering and translation.

```jsx
// ✅ Good - Hook returns data
export const useMarketData = (marketId) => {
  return {
    market: {
      type: 'WINNER_PREDICTION',  // Data
      count: 5,                    // Data
      status: 'active',            // Data
    }
  };
};

// Component handles translation
const MarketDisplay = () => {
  const { t } = useTranslation('market');
  const { market } = useMarketData(marketId);
  
  return <div>{t('winnerPredictionCount', { count: market.count })}</div>;
};

// ❌ Bad - Hook generates text
export const useMarketData = (marketId) => {
  return {
    market: {
      title: 'Winner Prediction (5)',  // Don't generate text in hooks
      statusText: 'Active',            // Don't generate text in hooks
    }
  };
};
```

## Component Development Standards

### UI Component System (Radix + shadcn/ui)

We adopt Radix UI primitives wrapped in shadcn-style components for accessibility and consistency.

Currently adopted primitives under `src/components/ui/`:

- **Dialog**: `@radix-ui/react-dialog` (`dialog.jsx`)
- **Label**: `@radix-ui/react-label` (`label.jsx`)
- **Toast**: `@radix-ui/react-toast` (`toast.jsx`, `toaster.jsx`)
- **Dropdown Menu**: `@radix-ui/react-dropdown-menu` (`dropdown-menu.jsx`)
- **Select**: `@radix-ui/react-select` (`select.jsx`)
- **Popover**: `@radix-ui/react-popover` (`popover.jsx`)
- **Tooltip**: `@radix-ui/react-tooltip` (`tooltip.jsx`)

Guidelines:

- **Prefer Radix** for overlays and complex a11y: dialog, popover, tooltip, dropdown-menu, select, toast, sheet, navigation-menu, context-menu.
- **Keep exports stable**: wrap Radix primitives in shadcn-style components with Tailwind classes and export simple APIs.
- **Styling**: Tailwind utilities + `cn` helper; no inline styles.
- **Animation**: use existing tailwindcss-animate utilities.

### Component Guidelines

#### 1. Functional Components Only

```jsx
// ✅ Good
const RaffleCard = ({ raffle, onJoin }) => {
  return <div className="card">{/* Component content */}</div>;
};

// ❌ Avoid class components
class RaffleCard extends Component {
  render() {
    return <div>Content</div>;
  }
}
```

#### 2. No React Import (Vite Handles This)

```jsx
// ✅ Good - Vite automatically injects React
import { useState } from "react";
import PropTypes from "prop-types";

// ❌ Unnecessary with Vite
import React, { useState } from "react";
```

#### 3. Consistent Component Structure

```jsx
// File: src/components/raffle/RaffleCard.jsx
import { useState } from "react";
import PropTypes from "prop-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const RaffleCard = ({
  raffle,
  onJoin,
  className,
  isLoading = false,
  ...props
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleJoin = () => {
    if (!isLoading) {
      onJoin(raffle.id);
    }
  };

  return (
    <Card className={cn("raffle-card", className)} {...props}>
      <CardHeader>
        <CardTitle>{raffle.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>{raffle.description}</p>
        <Button onClick={handleJoin} disabled={isLoading} className="mt-4">
          {isLoading ? "Joining..." : "Join Raffle"}
        </Button>
      </CardContent>
    </Card>
  );
};

// PropTypes for type checking
RaffleCard.propTypes = {
  raffle: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    description: PropTypes.string.isRequired,
  }).isRequired,
  onJoin: PropTypes.func.isRequired,
  className: PropTypes.string,
  isLoading: PropTypes.bool,
};

export default RaffleCard;
```

#### 4. Component Naming Conventions

- **PascalCase** for component names and files
- **camelCase** for props and variables
- **kebab-case** for CSS classes
- **Descriptive names** that indicate purpose

```jsx
// ✅ Good naming
const RaffleParticipationForm = () => {};
const UserDashboardSidebar = () => {};
const BondingCurveVisualization = () => {};

// ❌ Poor naming
const Form = () => {};
const Sidebar = () => {};
const Chart = () => {};
```

### Custom Hooks Guidelines

#### 1. Hook Naming Convention

```jsx
// ✅ Always start with 'use'
const useRaffleData = (raffleId) => {};
const useWalletConnection = () => {};
const usePredictionMarkets = () => {};

// ❌ Don't start with other prefixes
const getRaffleData = () => {}; // This should be a regular function
const raffleHook = () => {}; // Not descriptive enough
```

#### 2. Hooks Return Data, Components Handle Text

**Important:** Hooks should return raw data and state, not formatted text or UI strings. This ensures:

- Better separation of concerns
- All i18n logic centralized in components
- Easier testing of hooks
- No translation keys scattered in hooks

```jsx
// ✅ Good - Hook returns data
export const useArbitrageDetection = (seasonId, bondingCurveAddress) => {
  // ... detection logic ...
  
  return {
    opportunities: [
      {
        id: '...',
        direction: 'buy_raffle', // Data, not text
        rafflePrice: 10.5,        // Numbers
        marketPrice: 12.3,        // Numbers
        profitability: 15.2,      // Numbers
        // No 'strategy' text field
      }
    ],
    isLoading,
    error,
  };
};

// Component handles text rendering
const ArbitrageDisplay = () => {
  const { t } = useTranslation('market');
  const { opportunities } = useArbitrageDetection(seasonId, curveAddress);
  
  return opportunities.map(opp => (
    <div key={opp.id}>
      {/* Component generates text based on data */}
      {opp.direction === 'buy_raffle' 
        ? t('buyRaffleTickets', { price: opp.rafflePrice, sellPrice: opp.marketPrice })
        : t('buyInfoFiPosition', { price: opp.marketPrice, exitPrice: opp.rafflePrice })
      }
    </div>
  ));
};

// ❌ Bad - Hook generates text
export const useArbitrageDetection = (seasonId, bondingCurveAddress) => {
  return {
    opportunities: [
      {
        strategy: `Buy raffle tickets at ${price} SOF`, // Don't do this
        description: 'This is a good opportunity',      // Don't do this
      }
    ],
  };
};
```

#### 3. Hook Structure Template

```jsx
// File: src/hooks/useRaffleData.js
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { raffleService } from "@/services/raffleService";

export const useRaffleData = (raffleId, options = {}) => {
  const [localState, setLocalState] = useState(null);

  const {
    data: raffle,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["raffle", raffleId],
    queryFn: () => raffleService.getRaffle(raffleId),
    enabled: !!raffleId,
    staleTime: 30000, // 30 seconds
    ...options,
  });

  // Custom logic here
  useEffect(() => {
    if (raffle) {
      setLocalState(processRaffleData(raffle));
    }
  }, [raffle]);

  return {
    raffle,
    localState,
    isLoading,
    error,
    refetch,
    // Expose useful computed values
    isActive: raffle?.status === "active",
    timeRemaining: calculateTimeRemaining(raffle?.endTime),
  };
};

// Helper function (not exported)
const processRaffleData = (data) => {
  // Processing logic
  return processedData;
};

const calculateTimeRemaining = (endTime) => {
  // Time calculation logic
  return timeRemaining;
};
```

## Styling Guidelines

### Tailwind CSS Best Practices

#### 1. Use Utility Classes

```jsx
// ✅ Good - Utility classes
<div className="flex items-center justify-between p-4 bg-white rounded-lg shadow-md">
  <h2 className="text-xl font-semibold text-gray-800">Title</h2>
  <Button className="px-4 py-2 bg-blue-500 hover:bg-blue-600">Action</Button>
</div>

// ❌ Avoid inline styles
<div style={{ display: 'flex', padding: '16px', backgroundColor: 'white' }}>
  <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Title</h2>
</div>
```

#### 2. Component Variants with CVA

```jsx
// File: src/components/ui/badge.jsx
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline:
          "text-foreground border border-input bg-background hover:bg-accent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Badge = ({ className, variant, ...props }) => {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
};

export { Badge, badgeVariants };
```

#### 3. Responsive Design Patterns

```jsx
// ✅ Mobile-first responsive design
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  <RaffleCard />
  <RaffleCard />
  <RaffleCard />
</div>

// ✅ Responsive text and spacing
<h1 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-4 md:mb-6 lg:mb-8">
  SecondOrder.fun
</h1>
```

### CSS Custom Properties

```css
/* File: src/styles/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    /* More custom properties */
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    /* Dark mode overrides */
  }
}

@layer components {
  .raffle-card {
    @apply bg-card text-card-foreground rounded-lg border shadow-sm;
  }

  .btn-primary {
    @apply bg-primary text-primary-foreground hover:bg-primary/90;
  }
}
```

## State Management Patterns

### React Query for Server State

#### 1. Query Organization

```jsx
// File: src/services/queries/raffleQueries.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { raffleService } from "@/services/raffleService";

// Query keys for consistency
export const raffleKeys = {
  all: ["raffles"],
  lists: () => [...raffleKeys.all, "list"],
  list: (filters) => [...raffleKeys.lists(), filters],
  details: () => [...raffleKeys.all, "detail"],
  detail: (id) => [...raffleKeys.details(), id],
  positions: (id) => [...raffleKeys.detail(id), "positions"],
};

// Query hooks
export const useRaffles = (filters = {}) => {
  return useQuery({
    queryKey: raffleKeys.list(filters),
    queryFn: () => raffleService.getRaffles(filters),
    staleTime: 30000,
  });
};

export const useRaffle = (raffleId) => {
  return useQuery({
    queryKey: raffleKeys.detail(raffleId),
    queryFn: () => raffleService.getRaffle(raffleId),
    enabled: !!raffleId,
  });
};

// Mutation hooks
export const useJoinRaffle = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ raffleId, amount }) =>
      raffleService.joinRaffle(raffleId, amount),
    onSuccess: (data, variables) => {
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({
        queryKey: raffleKeys.detail(variables.raffleId),
      });
      queryClient.invalidateQueries({
        queryKey: raffleKeys.lists(),
      });
    },
  });
};
```

#### 2. Context for Global State

```jsx
// File: src/context/AuthContext.jsx
import { createContext, useContext, useReducer } from "react";
import PropTypes from "prop-types";

const AuthContext = createContext();

const authReducer = (state, action) => {
  switch (action.type) {
    case "LOGIN":
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        isAuthenticated: true,
      };
    case "LOGOUT":
      return {
        ...state,
        user: null,
        token: null,
        isAuthenticated: false,
      };
    case "UPDATE_PROFILE":
      return {
        ...state,
        user: { ...state.user, ...action.payload },
      };
    default:
      return state;
  }
};

const initialState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
};

export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  const login = (user, token) => {
    localStorage.setItem("token", token);
    dispatch({ type: "LOGIN", payload: { user, token } });
  };

  const logout = () => {
    localStorage.removeItem("token");
    dispatch({ type: "LOGOUT" });
  };

  const updateProfile = (updates) => {
    dispatch({ type: "UPDATE_PROFILE", payload: updates });
  };

  const value = {
    ...state,
    login,
    logout,
    updateProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
```

## Web3 Integration Guidelines

### Wallet Connection

```jsx
// File: src/components/wallet/WalletConnection.jsx
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";

const WalletConnection = () => {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isLoading } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <div className="flex items-center gap-4">
        <span className="text-sm">
          {address?.slice(0, 6)}...{address?.slice(-4)}
        </span>
        <Button onClick={() => disconnect()} variant="outline">
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {connectors.map((connector) => (
        <Button
          key={connector.id}
          onClick={() => connect({ connector })}
          disabled={isLoading}
        >
          Connect {connector.name}
        </Button>
      ))}
    </div>
  );
};

export default WalletConnection;
```

### Smart Contract Interactions

```jsx
// File: src/hooks/useRaffleContract.js
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from "wagmi";
import { parseEther, formatEther } from "viem";
import {
  RAFFLE_CONTRACT_ADDRESS,
  RAFFLE_ABI,
} from "@/contracts/raffleContract";

export const useRaffleContract = () => {
  const { writeContract, data: hash, isPending, error } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const joinRaffle = async (raffleId, amount) => {
    try {
      await writeContract({
        address: RAFFLE_CONTRACT_ADDRESS,
        abi: RAFFLE_ABI,
        functionName: "joinRaffle",
        args: [raffleId],
        value: parseEther(amount.toString()),
      });
    } catch (err) {
      console.error("Failed to join raffle:", err);
      throw err;
    }
  };

  return {
    joinRaffle,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
};

// Read-only contract hooks
export const useRaffleInfo = (raffleId) => {
  return useReadContract({
    address: RAFFLE_CONTRACT_ADDRESS,
    abi: RAFFLE_ABI,
    functionName: "getRaffleInfo",
    args: [raffleId],
    enabled: !!raffleId,
  });
};

export const useUserPosition = (raffleId, userAddress) => {
  return useReadContract({
    address: RAFFLE_CONTRACT_ADDRESS,
    abi: RAFFLE_ABI,
    functionName: "getUserPosition",
    args: [raffleId, userAddress],
    enabled: !!(raffleId && userAddress),
  });
};
```

### InfoFi Market IDs and On-Chain Enumeration

The canonical InfoFi Winner Prediction marketId is computed on-chain as:

```solidity
// contracts/src/infofi/InfoFiMarketFactory.sol
bytes32 marketId = keccak256(
  abi.encodePacked(seasonId, player, keccak256("WINNER_PREDICTION"))
);
```

Frontend must derive this value identically using `viem` utilities. The helper lives in `src/services/onchainInfoFi.js`:

```js
// computeWinnerMarketId({ seasonId, player }) -> 0x... bytes32
import { keccak256, encodePacked } from 'viem'

export function computeWinnerMarketId({ seasonId, player }) {
  const tag = keccak256(encodePacked(['string'], ['WINNER_PREDICTION']))
  return keccak256(
    encodePacked(['uint256', 'address', 'bytes32'], [BigInt(seasonId), player, tag])
  )
}
```

Enumerating InfoFi markets must be done from contract state (no DB):

- `getSeasonPlayers(seasonId)` → players eligible/observed for the season
- `hasWinnerMarket(seasonId, player)` → whether a WINNER_PREDICTION market exists

Use `listSeasonWinnerMarkets({ seasonId, networkKey })` from `src/services/onchainInfoFi.js`, which:

- Reads `getSeasonPlayers` and filters by `hasWinnerMarket`
- Computes canonical `marketId` per player using the derivation above
- Returns objects consumed by UI cards and price hooks

Live updates should subscribe to:

- `InfoFiMarketFactory.MarketCreated` to refresh the season’s markets
- `InfoFiPriceOracle.PriceUpdated` to update pricing in real time

See hooks:

- `src/hooks/useOnchainInfoFiMarkets.js` for listing + event subscription
- `src/hooks/useOraclePriceLive.js` for oracle reads + `PriceUpdated` subscription

## Error Handling & Loading States

### Error Boundaries

```jsx
// File: src/components/common/ErrorBoundary.jsx
import { Component } from "react";
import PropTypes from "prop-types";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
    // Send to error reporting service
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-muted-foreground mb-4">
              We're sorry, but something unexpected happened.
            </p>
            <Button
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try again
            </Button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
  fallback: PropTypes.node,
};

export default ErrorBoundary;
```

### Loading States

```jsx
// File: src/components/common/LoadingSpinner.jsx
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const LoadingSpinner = ({ size = "default", className }) => {
  const sizeClasses = {
    sm: "h-4 w-4",
    default: "h-8 w-8",
    lg: "h-12 w-12",
  };

  return (
    <Loader2
      className={cn("animate-spin text-primary", sizeClasses[size], className)}
    />
  );
};

// Usage in components
const RaffleList = () => {
  const { data: raffles, isLoading, error } = useRaffles();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner size="lg" />
        <span className="ml-2">Loading raffles...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-destructive">
        Failed to load raffles: {error.message}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {raffles?.map((raffle) => (
        <RaffleCard key={raffle.id} raffle={raffle} />
      ))}
    </div>
  );
};
```

## Performance Optimization

### Code Splitting & Lazy Loading

```jsx
// File: src/app/Router.jsx
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import MainLayout from "@/layouts/MainLayout";

// Lazy load pages
const LandingPage = lazy(() => import("@/pages/LandingPage"));
const BrowseRafflesPage = lazy(() => import("@/pages/BrowseRafflesPage"));
const CreateRafflePage = lazy(() => import("@/pages/CreateRafflePage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));

const Router = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route
            index
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <LandingPage />
              </Suspense>
            }
          />
          <Route
            path="raffles"
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <BrowseRafflesPage />
              </Suspense>
            }
          />
          {/* More routes... */}
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default Router;
```

### Memoization Patterns

```jsx
// File: src/components/raffle/RaffleStatistics.jsx
import { memo, useMemo } from "react";
import PropTypes from "prop-types";

const RaffleStatistics = memo(({ participants, totalValue, endTime }) => {
  // Expensive calculations memoized
  const statistics = useMemo(() => {
    const averageContribution = totalValue / participants.length;
    const timeRemaining = endTime - Date.now();
    const winProbabilities = participants.map((p) => ({
      address: p.address,
      probability: (p.tickets / totalTickets) * 100,
    }));

    return {
      averageContribution,
      timeRemaining,
      winProbabilities,
      totalTickets: participants.reduce((sum, p) => sum + p.tickets, 0),
    };
  }, [participants, totalValue, endTime]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Participants</p>
          <p className="text-2xl font-bold">{participants.length}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Total Value</p>
          <p className="text-2xl font-bold">{totalValue} SOF</p>
        </div>
      </div>
      {/* More statistics display */}
    </div>
  );
});

RaffleStatistics.displayName = "RaffleStatistics";

RaffleStatistics.propTypes = {
  participants: PropTypes.arrayOf(PropTypes.object).isRequired,
  totalValue: PropTypes.number.isRequired,
  endTime: PropTypes.number.isRequired,
};

export default RaffleStatistics;
```

## Testing Guidelines

### Component Testing

```jsx
// File: src/components/raffle/__tests__/RaffleCard.test.jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import RaffleCard from "../RaffleCard";

const mockRaffle = {
  id: "1",
  title: "Test Raffle",
  description: "A test raffle",
  status: "active",
  endTime: Date.now() + 86400000, // 24 hours from now
};

describe("RaffleCard", () => {
  it("renders raffle information correctly", () => {
    const onJoin = vi.fn();

    render(<RaffleCard raffle={mockRaffle} onJoin={onJoin} />);

    expect(screen.getByText("Test Raffle")).toBeInTheDocument();
    expect(screen.getByText("A test raffle")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /join raffle/i })
    ).toBeInTheDocument();
  });

  it("calls onJoin when join button is clicked", () => {
    const onJoin = vi.fn();

    render(<RaffleCard raffle={mockRaffle} onJoin={onJoin} />);

    const joinButton = screen.getByRole("button", { name: /join raffle/i });
    fireEvent.click(joinButton);

    expect(onJoin).toHaveBeenCalledWith("1");
  });

  it("disables join button when loading", () => {
    const onJoin = vi.fn();

    render(<RaffleCard raffle={mockRaffle} onJoin={onJoin} isLoading />);

    const joinButton = screen.getByRole("button", { name: /joining/i });
    expect(joinButton).toBeDisabled();
  });
});
```

### Hook Testing

```jsx
// File: src/hooks/__tests__/useRaffleData.test.js
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { useRaffleData } from "../useRaffleData";
import { raffleService } from "@/services/raffleService";

// Mock the service
vi.mock("@/services/raffleService");

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("useRaffleData", () => {
  it("fetches raffle data successfully", async () => {
    const mockRaffle = { id: "1", title: "Test Raffle" };
    raffleService.getRaffle.mockResolvedValue(mockRaffle);

    const { result } = renderHook(() => useRaffleData("1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.raffle).toEqual(mockRaffle);
    expect(result.current.error).toBeNull();
  });
});
```

## Accessibility Guidelines

### ARIA Labels and Semantic HTML

```jsx
// File: src/components/raffle/RaffleForm.jsx
const RaffleForm = ({ onSubmit }) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState({});

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="space-y-4">
        <div>
          <label htmlFor="raffle-title" className="block text-sm font-medium">
            Raffle Title *
          </label>
          <input
            id="raffle-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-describedby={errors.title ? "title-error" : undefined}
            aria-invalid={!!errors.title}
            className={cn(
              "mt-1 block w-full rounded-md border-input",
              errors.title && "border-destructive"
            )}
            required
          />
          {errors.title && (
            <p
              id="title-error"
              className="mt-1 text-sm text-destructive"
              role="alert"
            >
              {errors.title}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="raffle-description"
            className="block text-sm font-medium"
          >
            Description
          </label>
          <textarea
            id="raffle-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="mt-1 block w-full rounded-md border-input"
            aria-describedby="description-hint"
          />
          <p
            id="description-hint"
            className="mt-1 text-sm text-muted-foreground"
          >
            Provide details about your raffle (optional)
          </p>
        </div>

        <Button type="submit" className="w-full">
          Create Raffle
        </Button>
      </div>
    </form>
  );
};
```

### Keyboard Navigation

```jsx
// File: src/components/common/Modal.jsx
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const Modal = ({ isOpen, onClose, title, children }) => {
  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      // Store the currently focused element
      previousFocusRef.current = document.activeElement;

      // Focus the modal
      modalRef.current?.focus();

      // Prevent body scroll
      document.body.style.overflow = "hidden";
    } else {
      // Restore focus to the previously focused element
      previousFocusRef.current?.focus();

      // Restore body scroll
      document.body.style.overflow = "unset";
    }

    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="bg-background rounded-lg p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="modal-title" className="text-lg font-semibold">
            {title}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
};

export default Modal;
```

## Security Best Practices

### Input Sanitization

```jsx
// File: src/utils/sanitization.js
import DOMPurify from "dompurify";

export const sanitizeHTML = (html) => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["b", "i", "em", "strong", "p", "br"],
    ALLOWED_ATTR: [],
  });
};

export const sanitizeInput = (input) => {
  if (typeof input !== "string") return input;

  return input
    .trim()
    .replace(/[<>]/g, "") // Remove potential HTML tags
    .slice(0, 1000); // Limit length
};

// Usage in forms
const handleInputChange = (e) => {
  const sanitizedValue = sanitizeInput(e.target.value);
  setValue(sanitizedValue);
};
```

### Environment Variables Security

```jsx
// File: src/config/env.js
// Only VITE_ prefixed variables are available in the client
export const config = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || "http://localhost:3001",
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  WEB3_RPC_URL: import.meta.env.VITE_WEB3_RPC_URL,

  // Never access server-only env vars in frontend
  // JWT_SECRET is NOT available and should never be used here
};

// Validate required environment variables
const requiredEnvVars = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

for (const envVar of requiredEnvVars) {
  if (!import.meta.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}
```

## Build & Deployment Optimization

### Vite Configuration

```javascript
// File: vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "esnext",
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          web3: ["wagmi", "viem"],
          ui: ["@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu"],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
});
```

### Bundle Analysis

```bash
# Add to package.json scripts
{
  "scripts": {
    "build:analyze": "vite build && npx vite-bundle-analyzer dist"
  }
}
```

## Development Workflow

### Git Commit Convention

```git
feat: add raffle creation form
fix: resolve wallet connection issue
docs: update component guidelines
style: improve raffle card responsive design
refactor: extract reusable hook for contract interactions
test: add unit tests for RaffleCard component
chore: update dependencies
```

### Code Review Checklist

- [ ] Components follow naming conventions
- [ ] PropTypes are defined for all components
- [ ] No React imports in Vite components
- [ ] Accessibility attributes are present
- [ ] Error handling is implemented
- [ ] Loading states are handled
- [ ] Responsive design is implemented
- [ ] Performance optimizations are applied
- [ ] Tests are written and passing
- [ ] TypeScript/JSDoc types are accurate

## Real-time Streams (SSE) Usage

The app uses Server-Sent Events for live InfoFi hybrid pricing. Follow these patterns for consistent, testable real-time features.

### Hooks

- **`useSSE(url, onMessage, options)`** in `src/hooks/useSSE.js`
  - Options: `withCredentials`, `maxRetries`, `retryInterval`, `heartbeatInterval`, `EventSourceClass`
  - Supports injected `EventSourceClass` for deterministic tests
  - Uses `useLayoutEffect` to make connection timing deterministic

- **`usePricingStream(marketId)`** in `src/hooks/usePricingStream.js`
  - Composes `useSSE` to consume backend pricing stream
  - Normalizes all payloads to basis-points fields: `hybridPriceBps`, `raffleProbabilityBps`, `marketSentimentBps`
  - Endpoint: `/api/pricing/stream/pricing/:marketId` (proxied by Vite)

### Component

- **`InfoFiPricingTicker`** in `src/components/infofi/InfoFiPricingTicker.jsx`
  - Props:
    - `marketId: string | number` (required)
  - Renders live hybrid price, raffle probability, market sentiment, and connection status
  - Example:

    ```jsx
    import InfoFiPricingTicker from '@/components/infofi/InfoFiPricingTicker';

    <InfoFiPricingTicker marketId={seasonId} />
    ```

### Backend Endpoints (Fastify)

- `GET /api/pricing/stream/pricing/:marketId` — SSE stream (bps payload)
- `GET /api/pricing/stream/pricing/:marketId/current` — REST snapshot

Configured in `backend/fastify/routes/pricingRoutes.js`.

### Dev Proxy (Vite)

- `vite.config.js` proxies `/api` to Fastify (`http://localhost:3001`), so the frontend can call `/api/...` directly during development.

### Testing SSE

- Inject mock `EventSource` via the `EventSourceClass` option to `useSSE` for deterministic tests.
- Prefer real timers; avoid fake timers unless necessary.
- Wrap state-changing triggers in `act()`.

## Conclusion

These guidelines ensure consistent, maintainable, and performant frontend development for SecondOrder.fun. Regular code reviews and adherence to these standards will help maintain code quality as the project scales.

For questions or suggestions about these guidelines, please refer to the development team or create an issue in the project repository.
