// Boot entry. Runs env validation BEFORE importing server.js so the
// consolidated error message wins over any individual module's eager
// throw at import time (e.g. viemClient.js → chain.js fails on missing
// RPC_URL during ESM hoisting if we put assertRequiredEnv inside server.js).
import { assertRequiredEnv } from "../shared/assertRequiredEnv.js";

assertRequiredEnv();

// Dynamic import — only runs once env passes validation.
await import("./server.js");
