import { useState, useEffect } from "react";
import { safeStringify } from "@/lib/jsonUtils";
import { useSSEContext } from "@/hooks/useSSEContext";
import { useToast } from "@/hooks/useToast";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

const SSETest = () => {
  const { createConnection, removeConnection } = useSSEContext();
  const { toast } = useToast();
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const connection = createConnection(
      "test-stream",
      `${API_BASE}/events`,
      (data) => {
        // Handle incoming messages
        setMessages((prev) => [...prev, data]);

        // Show toast notification
        toast({
          title: "New Event",
          description: data.message || "Received new SSE event",
        });
      },
      {
        withCredentials: true,
        maxRetries: 3,
        retryInterval: 5000,
      }
    );

    if (connection) {
      setIsConnected(true);

      // Handle connection events
      connection.onopen = () => {
        // SSE connection opened
      };

      connection.onerror = () => {
        // SSE connection error occurred
        setIsConnected(false);
      };
    }

    // Clean up connection when component unmounts
    return () => {
      removeConnection("test-stream");
      setIsConnected(false);
    };
  }, [createConnection, removeConnection, toast]);

  const handleReconnect = () => {
    removeConnection("test-stream");
    setIsConnected(false);

    setTimeout(() => {
      const connection = createConnection(
        "test-stream",
        `${API_BASE}/events`,
        (data) => {
          setMessages((prev) => [...prev, data]);
          toast({
            title: "New Event",
            description: data.message || "Received new SSE event",
          });
        },
        {
          withCredentials: true,
          maxRetries: 3,
          retryInterval: 5000,
        }
      );

      if (connection) {
        setIsConnected(true);
      }
    }, 1000);
  };

  return (
    <div className="p-6 bg-card rounded-lg shadow">
      <h2 className="text-2xl font-semibold mb-4">SSE Test</h2>

      <div className="mb-4 flex items-center gap-4">
        <div className="flex items-center">
          <div
            className={`w-3 h-3 rounded-full mr-2 ${
              isConnected ? "bg-green-500" : "bg-red-500"
            }`}
          ></div>
          <span className="text-sm">
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </div>

        <button
          onClick={handleReconnect}
          className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          Reconnect
        </button>
      </div>

      <div className="mt-4">
        <h3 className="font-medium mb-2">Received Messages</h3>
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No messages received yet
          </p>
        ) : (
          <div className="max-h-60 overflow-y-auto">
            {messages.map((msg, index) => (
              <div key={index} className="p-2 mb-2 bg-muted rounded text-sm">
                <pre>{safeStringify(msg, 2)}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SSETest;
