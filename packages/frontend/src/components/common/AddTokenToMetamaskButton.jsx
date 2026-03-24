// src/components/common/AddTokenToMetamaskButton.jsx
import PropTypes from "prop-types";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, Wallet } from "lucide-react";

const AddTokenToMetamaskButton = ({
  address,
  symbol,
  decimals = 18,
  image,
  label,
  fullWidth = false,
  size = "default",
  variant = "outline",
  disabled = false,
  onResult,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState(null); // 'success' or 'error'

  const handleAddToMetamask = async () => {
    if (!address) return;

    if (typeof window === "undefined" || !window.ethereum) {
      const msg =
        "MetaMask is not installed. Please install MetaMask to use this feature.";
      if (onResult) {
        onResult({ type: "error", message: msg });
      } else {
        setMessageType("error");
        setMessage(msg);
      }
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const wasAdded = await window.ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address,
            symbol,
            decimals,
            image,
          },
        },
      });

      if (wasAdded) {
        const msg = `${symbol} token added to MetaMask successfully!`;
        if (onResult) {
          onResult({ type: "success", message: msg });
        } else {
          setMessageType("success");
          setMessage(msg);
          setTimeout(() => {
            setMessage(null);
          }, 5000);
        }
      } else {
        const msg = `Failed to add ${symbol} token to MetaMask.`;
        if (onResult) {
          onResult({ type: "error", message: msg });
        } else {
          setMessageType("error");
          setMessage(msg);
        }
      }
    } catch (error) {
      const msg = error?.message || "An error occurred while adding the token.";
      if (onResult) {
        onResult({ type: "error", message: msg });
      } else {
        setMessageType("error");
        setMessage(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button
        onClick={handleAddToMetamask}
        disabled={isLoading || !address || disabled}
        variant={variant || "outline"}
        size={size || "default"}
        className={fullWidth ? "w-full pl-2 pr-3" : "pl-2 pr-3"}
      >
        <Wallet className="mr-2 h-4 w-4" />
        {isLoading
          ? `Adding ${symbol}...`
          : label || `Add ${symbol} to MetaMask`}
      </Button>

      {!onResult && message && (
        <Alert
          variant={messageType === "error" ? "destructive" : "default"}
          className={
            messageType === "success" ? "bg-green-50 border-green-200" : ""
          }
        >
          {messageType === "success" ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <AlertTitle>
            {messageType === "success" ? "Success" : "Error"}
          </AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
};

AddTokenToMetamaskButton.propTypes = {
  address: PropTypes.string,
  symbol: PropTypes.string.isRequired,
  decimals: PropTypes.number,
  image: PropTypes.string,
  label: PropTypes.string,
  fullWidth: PropTypes.bool,
  size: PropTypes.string,
  variant: PropTypes.string,
  disabled: PropTypes.bool,
  onResult: PropTypes.func,
};

export default AddTokenToMetamaskButton;
