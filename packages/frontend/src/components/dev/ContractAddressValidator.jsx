// src/components/dev/ContractAddressValidator.jsx
// Development-only component that validates contract addresses and provides clear error messages

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Validates that contract addresses have deployed code
 * Only renders in development mode
 * Uses Vite env vars and checks if contracts are deployed on-chain
 */
export function ContractAddressValidator() {
  const publicClient = usePublicClient();

  const [validationResults, setValidationResults] = useState({});
  const [isValidating, setIsValidating] = useState(false);
  const [showValidator, setShowValidator] = useState(false);

  const validateAddresses = async () => {
    setIsValidating(true);
    const results = {};

    // Use env variables directly - they should be set in .env
    const contracts = {
      SOF: import.meta.env.VITE_SOF_ADDRESS_TESTNET || "",
      RAFFLE: import.meta.env.VITE_RAFFLE_ADDRESS_TESTNET || "",
      SEASON_FACTORY: import.meta.env.VITE_SEASON_FACTORY_ADDRESS_TESTNET || "",
      SOF_FAUCET: import.meta.env.VITE_SOF_FAUCET_ADDRESS_TESTNET || "",
      PRIZE_DISTRIBUTOR:
        import.meta.env.VITE_PRIZE_DISTRIBUTOR_ADDRESS_TESTNET || "",
    };

    // eslint-disable-next-line no-console
    //console.log('[ContractAddressValidator] Using addresses:', contracts);

    const contractsToValidate = {
      "SOF Token": contracts.SOF,
      Raffle: contracts.RAFFLE,
      "Season Factory": contracts.SEASON_FACTORY,
      "SOF Faucet": contracts.SOF_FAUCET,
      "Prize Distributor": contracts.PRIZE_DISTRIBUTOR,
    };

    for (const [name, address] of Object.entries(contractsToValidate)) {
      if (!address || address === "") {
        results[name] = { status: "missing", address: null };
        continue;
      }

      try {
        const code = await publicClient.getBytecode({ address });
        results[name] = {
          status: code && code !== "0x" && code !== "0x0" ? "valid" : "no-code",
          address,
        };
      } catch (error) {
        results[name] = { status: "error", address, error: error.message };
      }
    }

    setValidationResults(results);
    setIsValidating(false);

    // Auto-show if any issues found
    const hasIssues = Object.values(results).some((r) => r.status !== "valid");
    if (hasIssues) {
      setShowValidator(true);
    }
  };

  useEffect(() => {
    // Validate on mount
    validateAddresses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasIssues = Object.values(validationResults).some(
    (r) => r.status !== "valid",
  );
  const issueCount = Object.values(validationResults).filter(
    (r) => r.status !== "valid",
  ).length;

  // Only show in development
  if (import.meta.env.PROD) {
    return null;
  }

  if (!showValidator && !hasIssues) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md">
      {!showValidator && hasIssues && (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowValidator(true)}
          className="shadow-lg"
        >
          <AlertCircle className="h-4 w-4 mr-2" />
          {issueCount} Contract Issue{issueCount > 1 ? "s" : ""}
        </Button>
      )}

      {showValidator && (
        <Alert
          variant={hasIssues ? "destructive" : "default"}
          className="shadow-lg"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              {hasIssues ? (
                <AlertCircle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              )}
              <AlertTitle>Contract Address Validation</AlertTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowValidator(false)}
              className="h-6 w-6 p-0"
            >
              ×
            </Button>
          </div>

          <AlertDescription className="mt-2 space-y-2">
            {Object.entries(validationResults).map(([name, result]) => (
              <div key={name} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{name}:</span>
                  {result.status === "valid" && (
                    <span className="text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Valid
                    </span>
                  )}
                  {result.status === "missing" && (
                    <span className="text-yellow-600">Not configured</span>
                  )}
                  {result.status === "no-code" && (
                    <span className="text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> No contract
                    </span>
                  )}
                  {result.status === "error" && (
                    <span className="text-red-600">Error</span>
                  )}
                </div>
                {result.address && (
                  <div className="text-xs text-muted-foreground pl-4 font-mono break-all">
                    {result.address}
                  </div>
                )}
              </div>
            ))}

            {hasIssues && (
              <div className="mt-3 p-2 bg-muted rounded text-xs space-y-1">
                <p className="font-semibold">🔧 How to fix:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>
                    Run:{" "}
                    <code className="bg-background px-1 rounded">
                      npm run anvil:deploy
                    </code>
                  </li>
                  <li>
                    Restart Vite dev server (Ctrl+C, then{" "}
                    <code className="bg-background px-1 rounded">
                      npm run dev
                    </code>
                    )
                  </li>
                  <li>
                    Hard refresh browser:{" "}
                    <code className="bg-background px-1 rounded">
                      Cmd+Shift+R
                    </code>{" "}
                    (Mac) or{" "}
                    <code className="bg-background px-1 rounded">
                      Ctrl+Shift+R
                    </code>{" "}
                    (Windows)
                  </li>
                  <li>Click button below to clear cache</li>
                </ol>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Clear all storage
                localStorage.clear();
                sessionStorage.clear();
                // Force reload
                window.location.reload();
              }}
              className="w-full mt-2"
            >
              🗑️ Clear Cache & Reload
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={validateAddresses}
              disabled={isValidating}
              className="w-full mt-2"
            >
              {isValidating ? (
                <>
                  <RefreshCw className="h-3 w-3 mr-2 animate-spin" />
                  Validating...
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3 mr-2" />
                  Re-validate
                </>
              )}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
