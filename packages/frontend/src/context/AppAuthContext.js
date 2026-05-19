import { createContext } from "react";

// Bare React context for the global JWT lifecycle. Lives in its own file so
// consumers (hooks, lightweight components) can import it without pulling in
// AppAuthProvider's wagmi/viem dependency graph.
export const AppAuthContext = createContext(null);
