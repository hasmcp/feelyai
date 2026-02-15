import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { EventSourcePolyfill } from 'event-source-polyfill';

globalThis.EventSource = EventSourcePolyfill;

// --- THE FIX: Session ID Interceptor ---
// We use a closure to store the session ID privately
(function applySessionIdPatch() {
  let activeSessionId = null;

  // 1. Wrap window.fetch to capture the Session ID from the server's response
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    // Check if the server sent us a Session ID
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      activeSessionId = sessionId;
    }

    return response;
  };

  // 2. Wrap EventSource to inject the Session ID into the headers
  // We extend the Polyfill (which supports headers) instead of the native EventSource
  class PatchedEventSource extends EventSourcePolyfill {
    constructor(url, options = {}) {
      // If we captured a session ID, inject it into the headers
      if (activeSessionId) {
        options.headers = {
          ...options.headers,
          "Mcp-Session-Id": activeSessionId
        };
      }
      super(url, options);
    }
  }

  // Replace the global EventSource with our patched version
  globalThis.EventSource = PatchedEventSource;
})();

export class McpClient {
  constructor(url, headers) {
    this.url = url;
    this.headers = headers || {};
    this.client = null;
    this.transport = null;
    this.tools = [];
    this.isConnected = false;
  }

  async connect() {
    try {
      // StreamableHTTPClientTransport will now:
      // 1. POST to the URL
      // 2. Try to read Mcp-Session-Id (Needs Expose-Headers on server!)
      // 3. Open GET stream using EventSourcePolyfill with that ID in headers
      this.transport = new StreamableHTTPClientTransport(new URL(this.url), {
        requestInit: {
          headers: this.headers
        }
      });

      this.client = new Client(
        { name: "webllm-client", version: "1.0.0" },
        { capabilities: { tools: {} } }
      );

      await this.client.connect(this.transport);
      const result = await this.client.listTools();

      this.tools = result.tools.map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));

      this.isConnected = true;
    } catch (err) {
      throw err;
    }
  }

  async callTool(name, args) {
    if (!this.client) throw new Error("Not connected");
    const result = await this.client.callTool({ name, arguments: args });

    if (result.content?.[0]?.type === 'text') {
      return result.content[0].text;
    }
    return JSON.stringify(result);
  }

  async disconnect() {
    if (this.client) await this.client.close();
    this.isConnected = false;
  }
}