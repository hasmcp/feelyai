import { ref, reactive, onUnmounted, onMounted, toRaw } from 'vue';
import { McpClient } from '../services/McpClient';
import { messageStore } from '../services/MessageStore';
import EncryptionService from '../services/EncryptionService';
import LlmWorker from '../workers/llm.worker.js?worker';
import EvalWorker from '../workers/eval.worker.js?worker';
import Ajv from "ajv";

// ...

// (Inside useChat function)

// Define models that support Function Calling (Tools)
const AVAILABLE_MODELS = [
  { id: "TinyLlama-1.1B-Chat-v0.4-q4f32_1-MLC-1k", name: "TinyLlama 1.1B" },
  { id: "Hermes-3-Llama-3.1-8B-q4f32_1-MLC", name: "Hermes 3 (Llama 3.1 8B)" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", name: "Llama 3.2 3B" },
  { id: "Hermes-3-Llama-3.1-8B-q4f16_1-MLC", name: "Hermes 3 (Llama 3.1 8B - q4f16)" },
  { id: "Qwen2.5-Coder-3B-Instruct-q4f32_1-MLC", name: "Qwen2.5-Coder-3B" },
];

const DEFAULT_SYSTEM_PROMPT = `You are a helpful and capable AI assistant with access to powerful tools.

YOUR PRIMARY DIRECTIVE: Always listen carefully to the user's request and do exactly what they ask. Be helpful, accurate, and responsive to their needs.

TOOL USAGE PROTOCOL:
1. DISCOVER: You do not know your tools yet. ALWAYS start by calling '{"name": "listTools", "arguments": {}}' to see what functions are available.
2. LEARN: Before using any tool, you MUST call '{"name": "getToolSchema", "arguments": {"name": "<tool_name>"}}' to understand its arguments.
3. EXECUTE: Call the tool using the exact schema you retrieved.
4. CODE EVALS: You can use evalCode to run any code in browser '{"name": "evalCode", "arguments": {"code": "result = <YOUR_CODE>; return result;"}}'. You must end your code with 'return <VAR>;'

AVAILABLE TOOLS: {{listTools}}

IMPORTANT RULES:
- ALWAYS prioritize what the user asks for - your job is to help them accomplish their goals
- Use the 'evalCode' tool for all math, logic, date/time calculations, and JavaScript execution
- Reply naturally to greetings (e.g., "Hi", "Hello") without using tools
- When the user asks you to do something, DO IT - don't just explain how to do it
- Output strictly valid JSON for tool calls: {"name": "tool_name", "arguments": { ... }}
- Be proactive and helpful - if you can solve the user's problem with available tools, do so immediately`;

// --- Global Singleton State ---
const worker = ref(null);

// --- UI State ---
const isModelLoading = ref(false);
const isGenerating = ref(false);
const loadProgress = ref(0);
const loadText = ref("Initializing...");
const messages = ref([]);
const customSystemPrompt = ref(DEFAULT_SYSTEM_PROMPT);

// --- Projects & Chats ---
const projects = ref([]);
const currentProjectId = ref(null);
const chats = ref([]);
const activeChatId = ref(null);
const activeChatTitle = ref("General");

// --- Encrypted Projects State ---
const unlockedProjects = ref(new Map()); // Map<projectId, { chats, messages, systemPrompt }>
const isUnlockModalOpen = ref(false);
const unlockingProjectId = ref(null);
const unlockPassword = ref("");
const unlockError = ref("");

// Model Selection
const availableModels = AVAILABLE_MODELS;
const selectedModel = ref(AVAILABLE_MODELS[0].id);

// --- MCP Servers State ---
const mcpServers = reactive([]);

// --- Authorization State ---
const pendingToolCalls = ref(null);
const sessionAllowed = ref(new Set());
const useSafeEval = ref(true);

export function useChat() {
  // Functions will use the global state variables defined above
  // ...

  // --- Persistence ---
  const saveToStorage = () => {
    const data = mcpServers.map(s => ({
      url: s.url,
      enabled: s.enabled,
      name: s.name,
      headers: s.headers
    }));
    localStorage.setItem('mcp_configs', JSON.stringify(data));
    // Note: System prompt is now per-project, not global

    // Save last active chat/project state
    if (currentProjectId.value) localStorage.setItem('last_project_id', currentProjectId.value);
    if (activeChatId.value) localStorage.setItem('last_chat_id', activeChatId.value);
    localStorage.setItem('use_safe_eval', String(useSafeEval.value));
  };

  const loadFromStorage = async () => {
    // System prompt is now loaded per-project in selectProject
    // No longer loading global system prompt here

    const saved = localStorage.getItem('mcp_configs');
    if (saved) {
      try {
        const configs = JSON.parse(saved);
        for (const conf of configs) {
          await addServer(conf.url, conf.enabled, conf.name, conf.headers);
        }
      } catch (e) {
        console.error("Failed to load servers", e);
      }
    }

    const savedSafeEval = localStorage.getItem('use_safe_eval');
    if (savedSafeEval !== null) {
      useSafeEval.value = savedSafeEval === 'true';
    }
  };

  const resetSystemPrompt = async () => {
    customSystemPrompt.value = DEFAULT_SYSTEM_PROMPT;
    // Save to current project
    if (currentProjectId.value) {
      await updateProjectSystemPrompt(DEFAULT_SYSTEM_PROMPT);
    }
  };

  const updateProjectSystemPrompt = async (newPrompt) => {
    if (!currentProjectId.value) return;

    const project = projects.value.find(p => p.id === currentProjectId.value);
    if (project) {
      project.systemPrompt = newPrompt;
      await messageStore.updateProject(toRaw(project));
      customSystemPrompt.value = newPrompt;
    }
  };

  // --- Project/Chat Logic ---
  const loadProjects = async () => {
    const regularProjects = await messageStore.getProjects();
    const encryptedProjects = await messageStore.getEncryptedProjects();

    // Combine both types of projects
    projects.value = [...regularProjects, ...encryptedProjects];

    // Create default project if none exist
    if (projects.value.length === 0) {
      const defaultProj = await messageStore.createProject("Default Project");
      projects.value = [defaultProj];
    }

    // Load last project or default
    const lastPid = localStorage.getItem('last_project_id');
    const targetProj = projects.value.find(p => p.id === lastPid) || projects.value[0];
    await selectProject(targetProj.id);
  };

  const selectProject = async (projectId) => {
    currentProjectId.value = projectId;

    // Load project's system prompt
    const project = projects.value.find(p => p.id === projectId);
    if (project) {
      customSystemPrompt.value = project.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    } else {
      customSystemPrompt.value = DEFAULT_SYSTEM_PROMPT;
    }

    chats.value = await messageStore.getChats(projectId);

    // If we have chats, load the last active one, OR the most recent one
    if (chats.value.length > 0) {
      const lastCid = localStorage.getItem('last_chat_id');
      const targetChat = chats.value.find(c => c.id === lastCid) || chats.value[0];
      await selectChat(targetChat.id);
    } else {
      // Create a default chat for this project if empty
      const newChat = await messageStore.createChat(projectId, "General");
      chats.value = [newChat];
      await selectChat(newChat.id);
    }
    saveToStorage();
  };

  const createProject = async (name) => {
    const project = await messageStore.createProject(name);
    projects.value.push(project);
    await selectProject(project.id);
  };

  const createEncryptedProject = async (name, password) => {
    try {
      // Hash the password
      const passwordHash = await EncryptionService.hashPassword(password);

      // Create encrypted project in database
      const project = await messageStore.createEncryptedProject(name, passwordHash);

      // Add to projects list (will show as locked)
      projects.value.push(project);

      // Create initial empty encrypted content
      const projectData = {
        chats: [],
        messages: [],
        systemPrompt: null
      };

      const encryptedData = await EncryptionService.encryptProject(projectData, password);
      await messageStore.saveEncryptedContent(project.id, encryptedData);

      // Auto-select the project (it will be locked initially)
      await selectProject(project.id);
    } catch (error) {
      console.error('Failed to create encrypted project:', error);
      throw error;
    }
  };

  const unlockProject = async (projectId, password) => {
    try {
      unlockError.value = "";

      // Get project metadata
      const project = await messageStore.getEncryptedProject(projectId);
      if (!project) {
        throw new Error('Project not found');
      }

      // Verify password
      const isValid = await EncryptionService.verifyPassword(password, project.passwordHash);
      if (!isValid) {
        unlockError.value = "Incorrect password";
        return false;
      }

      // Get encrypted content
      const encryptedContent = await messageStore.getEncryptedContent(projectId);
      if (!encryptedContent) {
        throw new Error('Encrypted content not found');
      }

      // Decrypt content
      const decryptedData = await EncryptionService.decryptProject(encryptedContent, password);

      // Store decrypted data in memory
      unlockedProjects.value.set(projectId, decryptedData);

      // Close unlock modal
      isUnlockModalOpen.value = false;
      unlockingProjectId.value = null;
      unlockPassword.value = "";

      return true;
    } catch (error) {
      console.error('Failed to unlock project:', error);
      unlockError.value = error.message || "Failed to unlock project";
      return false;
    }
  };

  const lockProject = (projectId) => {
    // Remove decrypted data from memory
    unlockedProjects.value.delete(projectId);

    // If this was the current project, clear chats and messages
    if (currentProjectId.value === projectId) {
      chats.value = [];
      messages.value = [];
    }
  };

  const isProjectLocked = (projectId) => {
    const project = projects.value.find(p => p.id === projectId);
    if (!project || !project.isPasswordProtected) return false;
    return !unlockedProjects.value.has(projectId);
  };

  const selectChat = async (chatId) => {
    activeChatId.value = chatId;
    messages.value = await messageStore.getMessages(chatId, 50); // Load last 50
    // Scroll to bottom happens via watcher in App.vue

    const chat = chats.value.find(c => c.id === chatId);
    if (chat) activeChatTitle.value = chat.title;

    saveToStorage();
  };

  const createNewChat = async () => {
    if (!currentProjectId.value) return;
    const newChat = await messageStore.createChat(currentProjectId.value, "New Chat");
    chats.value = await messageStore.getChats(currentProjectId.value);
    await selectChat(newChat.id);
  };

  const renameChat = async (chatId, newTitle) => {
    const chat = chats.value.find(c => c.id === chatId);
    if (chat) {
      chat.title = newTitle;
      // Use toRaw to ensure we pass a plain object to IndexedDB
      await messageStore.updateChat(toRaw(chat));
      if (activeChatId.value === chatId) activeChatTitle.value = newTitle;
    }
  };

  const deleteChat = async (chatId) => {
    await messageStore.deleteChat(chatId);
    chats.value = await messageStore.getChats(currentProjectId.value);
    if (activeChatId.value === chatId) {
      if (chats.value.length > 0) {
        await selectChat(chats.value[0].id);
      } else {
        // Create a new one if deleted all
        await createNewChat();
      }
    }
  };

  const deleteProject = async (projectId) => {
    // Find the project to check if it's encrypted
    const project = projects.value.find(p => p.id === projectId);

    if (project?.isPasswordProtected) {
      // Delete from encrypted database
      await messageStore.deleteEncryptedProject(projectId);
      // Remove from unlocked projects if it was unlocked
      unlockedProjects.value.delete(projectId);
    } else {
      // Delete from regular database
      await messageStore.deleteProject(projectId);
    }

    // Reload all projects
    await loadProjects();

    // If deleted active project, switch to default or another
    if (currentProjectId.value === projectId) {
      if (projects.value.length > 0) {
        await selectProject(projects.value[0].id);
      } else {
        // Creating a new default project if all are gone
        const defaultProj = await messageStore.createProject("Default Project");
        projects.value = [defaultProj];
        await selectProject(defaultProj.id);
      }
    }
  };

  // --- Server Management ---
  const connectServer = async (server) => {
    server.status = 'connecting';
    server.error = null;
    server.client = new McpClient(server.url, server.headers);

    try {
      await server.client.connect();
      server.status = 'connected';
      server.toolCount = server.client.tools.length;
    } catch (e) {
      server.status = 'error';
      server.error = e.message;
      server.toolCount = 0;
    }
  };

  const addServer = async (url, enabled = true, name = "", headers = {}) => {
    const cleanUrl = url.trim().replace(/\/$/, "");

    const existing = mcpServers.find(s => s.url === cleanUrl);
    if (existing) {
      if (name && !existing.name) {
        existing.name = name;
        saveToStorage();
      }
      return;
    }

    const server = reactive({
      id: Date.now() + Math.random(),
      url: cleanUrl,
      name: name || "",
      headers: headers || {},
      enabled,
      status: 'idle',
      toolCount: 0,
      error: null,
      client: null
    });

    mcpServers.push(server);
    if (enabled) {
      await connectServer(server);
    } else {
      server.status = 'disabled';
    }
    saveToStorage();
  };

  const toggleServer = async (id) => {
    const server = mcpServers.find(s => s.id === id);
    if (!server) return;

    server.enabled = !server.enabled;

    if (server.enabled) {
      await connectServer(server);
    } else {
      if (server.client) {
        try { await server.client.disconnect(); } catch (e) { console.warn(e); }
        server.client = null;
      }
      server.status = 'disabled';
      server.toolCount = 0;
    }
    saveToStorage();
  };

  const removeServer = async (id) => {
    const idx = mcpServers.findIndex(s => s.id === id);
    if (idx !== -1) {
      const server = mcpServers[idx];
      if (server.client) {
        try { await server.client.disconnect(); } catch (e) { console.warn(e); }
      }
      mcpServers.splice(idx, 1);
      saveToStorage();
    }
  };

  const buildSystemPrompt = () => {
    // 1. Get Active Tools from MCP servers
    const mcpTools = mcpServers
      .filter(s => s.enabled && s.status === 'connected' && s.client)
      .flatMap(s => s.client.tools);

    // 2. Define the virtual tool for introspection
    const virtualTools = [
      {
        type: "function",
        function: {
          name: "getToolSchema",
          description: "Get the input schema for a specific tool.",
          parameters: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The name of the tool to inspect.",
              },
            },
            required: ["name"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "evalCode",
          description: "Execute JavaScript code. Use this for math, date/time, text processing, or logic.",
          parameters: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "The JavaScript code to execute. The last expression must include return statement. e.g: return Math.sqrt(144)",
              },
            },
            required: ["code"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "listTools",
          description: "List available tools. Returns a list of tool names and descriptions. Supports searching by query string (BM25-like ranking) or regex.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Optional search query to filter tools.",
              },
              use_regex: {
                type: "boolean",
                description: "If true, treats the query as a regular expression.",
              },
            },
          },
        },
      },
    ];

    // 3. Combine all tools
    const fullTools = [...virtualTools, ...mcpTools];

    // 4. Create "Hidden" Tools for LLM (Schema Discovery Pattern)
    // We strip parameters from all tools EXCEPT getToolSchema, listTools, and evalCode to force the LLM to ask for them.
    const llmTools = fullTools.map(t => {
      if (t.function.name === 'getToolSchema' || t.function.name === 'evalCode' || t.function.name === 'listTools') return t;
      return {
        ...t,
        function: {
          ...t.function,
          parameters: {
            type: "object",
            properties: {},
            description: "Parameters hidden. Call getToolSchema to view."
          }
        }
      };
    });

    // 5. Generate Dynamic System Prompt with tool descriptions
    // We use llmTools here so the descriptions might be less verbose if they relied on params, 
    // but usually description is top-level.
    const toolListString = llmTools
      .map(t => `\n- ${t.function.name}: ${t.function.description || 'No description available.'}`)
      .join("");

    const toolNamesString = llmTools.map(t => t.function.name).join(", ");

    let content = customSystemPrompt.value.trim();

    if (!content) {
      content = DEFAULT_SYSTEM_PROMPT;
    }

    // Template Replacement
    content = content.replace('{{listTools}}', toolListString);
    content = content.replace('{{tool_names}}', toolNamesString);

    return {
      prompt: { role: "system", content },
      tools: fullTools,     // Used for internal execution & validation
      llmTools: llmTools    // Used for sending to LLM context
    };
  };

  const getSystemPrompt = () => {
    return buildSystemPrompt().prompt.content;
  };

  // --- WebLLM Logic ---
  const initModel = async () => {
    // 1. Load Configurations
    await loadFromStorage();

    // 2. Load Projects & Chats (CRITICAL: Must happen before we can save messages)
    await loadProjects();

    // 3. Initialize Worker
    if (worker.value) return;

    isModelLoading.value = true;
    worker.value = new LlmWorker();

    worker.value.onmessage = async (e) => {
      const { type, data, message, error } = e.data;

      if (type === "progress") {
        loadProgress.value = data.progress;
        loadText.value = data.text;
      } else if (type === "ready") {
        isModelLoading.value = false;
      } else if (type === "complete") {
        if (message.content && message.content.includes("Got error: SyntaxError:")) {
          message.content = message.content.split("Got error:")[0].trim();
        }

        // Fix: Ensure ID and ChatID are on the message object itself before processing
        // This prevents DataError when updateMessage is called later on this same object
        if (!message.id) message.id = crypto.randomUUID();
        message.chatId = activeChatId.value;

        await messageStore.addMessage(message);
        // Note: usage of activeChatId.value here relies on it being set.
        await handleWorkerResponse(message);
      } else if (type === "error") {
        console.error("Worker Error:", error);
        pushMessage({ role: "assistant", content: `_Error: ${error}_` });
        isGenerating.value = false;
      }
    };

    worker.value.postMessage({
      type: "init",
      payload: { modelId: selectedModel.value }
    });
  };

  // NEW: Switch Model Function
  const switchModel = async (newModelId) => {
    if (newModelId === selectedModel.value && worker.value) return;

    selectedModel.value = newModelId;

    // Terminate existing worker
    if (worker.value) {
      worker.value.terminate();
      worker.value = null;
    }

    // Reset state
    // Don't clear messages view when switching model, context remains
    isGenerating.value = false;

    // Re-initialize
    await initModel();
  };

  const pushMessage = (msg) => {
    if (!msg.timestamp) msg.timestamp = Date.now();

    // Key: Attach the current chat ID
    if (activeChatId.value) {
      msg.chatId = activeChatId.value;
      messageStore.addMessage(msg);
      messages.value.push(msg);
    } else {
      console.error("CRITICAL: No active chat ID", msg);
      // Fallback: Create a temporary chat if none exists?
      // For now, just logging error as this shouldn't happen if loadProjects succeeds.
    }
  };

  const sendMessage = async (content) => {
    if (!worker.value || !content.trim()) return;

    // Ensure we have an active chat
    if (!activeChatId.value) {
      console.warn("No active chat, attempting to create one...");
      if (currentProjectId.value) {
        const newChat = await messageStore.createChat(currentProjectId.value, "New Chat");
        chats.value = await messageStore.getChats(currentProjectId.value);
        await selectChat(newChat.id);
      } else {
        // Should not happen if loadProjects worked
        await loadProjects();
      }
    }

    // Auto-update title if it's "New Chat" and it's the first few messages
    if (activeChatTitle.value === "New Chat" && messages.value.length < 2) {
      const newTitle = content.slice(0, 30) + (content.length > 30 ? "..." : "");
      await renameChat(activeChatId.value, newTitle);
    }

    const msg = { role: "user", content, timestamp: Date.now() };
    pushMessage(msg);
    isGenerating.value = true;
    postChatToWorker();
  };

  const postChatToWorker = () => {
    // 1. Get the dynamic system prompt and tool definitions
    // We use llmTools (hidden params) for the worker
    const { prompt: systemPrompt, llmTools } = buildSystemPrompt();

    // 2. Prepare Messages (Sanitize + Prepend System Prompt)

    const processedMessages = [];
    const rawMessages = messages.value.filter(m => m.role !== 'system');

    for (let i = 0; i < rawMessages.length; i++) {
      const msg = rawMessages[i];

      // Deep copy
      const cleanMsg = JSON.parse(JSON.stringify(msg));

      if (cleanMsg.role === 'assistant' && cleanMsg.tool_calls && cleanMsg.tool_calls.length > 0) {
        // Convert tool_calls to text content for the kept message
        const toolsObj = cleanMsg.tool_calls.map(tc => {
          let args = tc.function.arguments;
          if (typeof args === 'string') {
            try {
              args = JSON.parse(args);
            } catch (e) { /* ignore */ }
          }
          return {
            name: tc.function.name,
            arguments: args
          };
        });

        const toolsJson = "```json\n" + JSON.stringify(toolsObj, null, 2) + "\n```";

        if (cleanMsg.content) {
          cleanMsg.content += `\n${toolsJson}`;
        } else {
          cleanMsg.content = toolsJson;
        }

        // Remove the structured field so engine treats it as just text
        delete cleanMsg.tool_calls;
      }

      // Downgrade Tool Output to User Message
      if (cleanMsg.role === 'tool') {
        cleanMsg.role = 'user';
        // Use a distinctive header
        cleanMsg.content = `Tool Output [${cleanMsg.name}]:\n${cleanMsg.content}`;
        // Aggressively clean up tool-specific fields that might confuse the engine
        delete cleanMsg.tool_call_id;
        delete cleanMsg.name;
      }

      if (cleanMsg.role === 'assistant' && cleanMsg.content === null) {
        cleanMsg.content = "";
      }

      processedMessages.push(cleanMsg);
    }

    const finalMessages = [systemPrompt, ...processedMessages];

    // 3. Send to Worker
    const payload = JSON.parse(JSON.stringify({
      messages: finalMessages,
      tools: llmTools // Send hidden tools to LLM
    }));

    worker.value.postMessage({
      type: "chat",
      payload: payload
    });
  };

  // --- Tool Execution Logic ---

  const ajv = new Ajv();

  // Helper to generate a valid example from a schema
  const generateExample = (schema) => {
    if (!schema) return {};

    if (schema.example) return schema.example;
    if (schema.default) return schema.default;
    if (schema.const) return schema.const;
    if (schema.enum && schema.enum.length > 0) return schema.enum[0];

    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

    if (type === 'object') {
      const example = {};
      const requiredFields = schema.required || [];

      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          // Only include required fields to keep examples minimal
          if (requiredFields.includes(key)) {
            example[key] = generateExample(propSchema);
          }
        }
      }
      return example;
    }

    if (type === 'array') {
      if (schema.items) {
        return [generateExample(schema.items)];
      }
      return [];
    }

    if (type === 'string') return "example_string";
    if (type === 'number' || type === 'integer') return 123;
    if (type === 'boolean') return true;
    if (type === 'null') return null;

    return {};
  };

  // Helper to validate a single tool call
  const validateToolCall = (call, activeTools) => {
    if (call.function.name === 'getToolSchema') return { valid: true };

    const toolDef = activeTools.find(t => t.function.name === call.function.name);
    if (!toolDef) {
      return { valid: false, error: `Tool '${call.function.name}' not found.` };
    }

    try {
      const args = JSON.parse(call.function.arguments);
      if (toolDef.function.parameters) {
        const validate = ajv.compile(toolDef.function.parameters);
        const valid = validate(args);
        if (!valid) {
          return {
            valid: false,
            error: ajv.errorsText(validate.errors),
            schema: toolDef.function.parameters
          };
        }
      }
      return { valid: true };
    } catch (e) {
      return {
        valid: false,
        error: "Invalid JSON arguments: " + e.message,
        schema: toolDef.function.parameters // Return schema so we can generate example
      };
    }
  };

  const handleWorkerResponse = async (message) => {
    let toolCalls = message.tool_calls;
    if (toolCalls && !Array.isArray(toolCalls)) {
      message.tool_calls = [toolCalls];
      toolCalls = message.tool_calls;
    }

    if (toolCalls && toolCalls.length > 0) {
      // --- Pre-Validation Logic ---
      const { tools: activeTools } = buildSystemPrompt();
      const validationResults = toolCalls.map(call => ({
        call,
        result: validateToolCall(call, activeTools)
      }));

      const hasInvalidCalls = validationResults.some(r => !r.result.valid);

      // Logic:
      // 1. Find the first invalid call.
      // 2. We want to EXECUTE all valid calls up to the first invalid one.
      // 3. We want to REPORT the error for the first invalid one.
      // 4. We want to DROP all subsequent calls.

      const firstInvalidIndex = validationResults.findIndex(r => !r.result.valid);

      let callsToProcess = [];
      let errorCall = null;

      if (firstInvalidIndex !== -1) {
        // We have an error.
        // Valid calls before the error:
        callsToProcess = validationResults.slice(0, firstInvalidIndex).map(r => r.call);
        // The error call:
        errorCall = validationResults[firstInvalidIndex];
      } else {
        // All valid
        callsToProcess = toolCalls;
      }

      // --- Deduplication Logic ---
      // Remove redundant tool calls with the same name and arguments
      const seen = new Map();
      const deduplicatedCalls = [];

      for (const call of callsToProcess) {
        const key = `${call.function.name}::${call.function.arguments}`;
        if (!seen.has(key)) {
          seen.set(key, true);
          deduplicatedCalls.push(call);
        }
      }

      callsToProcess = deduplicatedCalls;

      // Update message.tool_calls to reflect ONLY what we are processing (Valid + The Error one)
      // We drop everything after the error.
      const visibleCalls = [...callsToProcess];
      if (errorCall) visibleCalls.push(errorCall.call);

      if (message.tool_calls && Array.isArray(message.tool_calls)) {
        message.tool_calls = visibleCalls;
      }

      // 3. Persist the ASSISTANT message (Request)
      await messageStore.updateMessage(message);
      messages.value.push(message);

      // 4. Check Permissions for the VALID calls only
      // We don't ask permission for the error call, we just report it.

      const allowAll = localStorage.getItem('mcp_allow_all') === 'true';
      const alwaysAllowed = ['getToolSchema', 'listTools'];

      const needsApproval = callsToProcess.filter(call => {
        if (alwaysAllowed.includes(call.function.name)) return false;
        if (allowAll) return false;
        if (sessionAllowed.value.has(call.function.name)) return false;
        return true;
      });

      // Define execution runner
      const runExecution = async () => {
        if (callsToProcess.length > 0) {
          await executeTools(callsToProcess, !!errorCall);
        }
        if (errorCall) {
          const { call, result } = errorCall;
          let content = `Error: ${result.error}`;

          // If we have a schema (tool exists but args are wrong), provide detailed help
          if (result.schema) {
            const argsExample = generateExample(result.schema);
            const fullExample = {
              name: call.function.name,
              arguments: argsExample
            };
            content += `\n\nExpected Schema:\n${JSON.stringify(result.schema, null, 2)}\n\nExpected Example:\n${JSON.stringify(fullExample, null, 2)}\n\nYou MUST generate a NEW tool call with the name '${call.function.name}' and the corrected arguments based on the JSON schema above.`;
          } else {
            // Tool doesn't exist - suggest using listTools
            content += `\n\nThe tool '${call.function.name}' does not exist. Use '{"name": "listTools", "arguments": {}}' to see available tools.`;
          }

          pushMessage({
            role: "tool",
            tool_call_id: call.id,
            content: content,
            name: call.function.name
          });
          postChatToWorker();
        }
      };

      if (needsApproval.length === 0) {
        await runExecution();
      } else {
        pendingToolCalls.value = {
          calls: callsToProcess,
          errorCall: errorCall
        };
      }
    } else {
      messages.value.push(message);
      isGenerating.value = false;
    }
  };

  const approveToolCalls = async (mode) => {
    if (!pendingToolCalls.value) return;

    const calls = pendingToolCalls.value.calls;
    const errorCall = pendingToolCalls.value.errorCall;

    if (mode === 'always') localStorage.setItem('mcp_allow_all', 'true');
    if (mode === 'session') {
      // Add all pending tools to the session allowed set
      calls.forEach(call => sessionAllowed.value.add(call.function.name));
    }

    pendingToolCalls.value = null;
    await executeTools(calls, !!errorCall);

    // If we had a pending error call that was deferred, report it now
    if (errorCall) {
      const { call, result } = errorCall;
      let content = '';
      if (result.schema) {
        const argsExample = generateExample(result.schema);
        const fullExample = {
          name: call.function.name,
          arguments: argsExample
        };
        content += `\n\nExpected Schema:\n${JSON.stringify(result.schema, null, 2)}\n\nExpected Example:\n${JSON.stringify(fullExample, null, 2)}\n\nYou MUST generate a NEW tool call with the name '${call.function.name}' and the corrected arguments based on the JSON schema above.\n\nWhat was wrong with your input: ${result.error}`;
      }
      pushMessage({
        role: "tool",
        tool_call_id: call.id,
        content: content,
        name: call.function.name
      });
      postChatToWorker();
    }
  };

  const cancelToolCalls = () => {
    pendingToolCalls.value = null;
    isGenerating.value = false;
    pushMessage({
      role: "assistant",
      content: "_Tool execution declined._"
    });
  };


  const evalSafe = async (userCode) => {
    return new Promise((resolve, reject) => {
      // Create a new Worker instance
      const worker = new EvalWorker();

      // SAFETY: Set a timeout (e.g., 1000ms)
      // If the code doesn't finish in 1 second, we kill it.
      const timeoutId = setTimeout(() => {
        worker.terminate();
        reject(new Error('Execution timed out (Infinite loop detected?)'));
      }, 1000);

      // Listen for the result
      worker.onmessage = (e) => {
        clearTimeout(timeoutId); // Code finished, clear the kill switch
        worker.terminate();      // Clean up the worker
        resolve(e.data);         // Return data to your UI
      };

      // Handle Worker Errors (syntax errors, etc)
      worker.onerror = (e) => {
        clearTimeout(timeoutId);
        worker.terminate();
        reject(new Error(e.message));
      };

      // Send the code to the worker
      worker.postMessage(userCode);
    });
  }

  const executeTools = async (calls) => {
    const { tools: activeTools } = buildSystemPrompt();

    for (const call of calls) {
      if (call.function.name === 'getToolSchema') {
        try {
          const args = JSON.parse(call.function.arguments);
          const toolName = args.tool_name || args.name || args.tool;
          const tool = activeTools.find(t => t.function.name === toolName);

          if (tool) {
            pushMessage({
              role: "tool",
              tool_call_id: call.id,
              name: call.function.name,
              content: JSON.stringify(tool.function.parameters, null, 2),
            });
          } else {
            throw new Error(`Tool '${toolName}' not found.`);
          }
        } catch (err) {
          pushMessage({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: "Error: " + err.message,
          });
        }
      }
      if (call.function.name === 'listTools') {
        try {
          // Parse arguments safely
          let args = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch (e) { /* ignore */ }

          const query = args.query;
          const useRegex = args.use_regex;

          let results = activeTools;

          if (query) {
            if (useRegex) {
              try {
                const regex = new RegExp(query, 'i');
                results = activeTools.filter(t =>
                  regex.test(t.function.name) ||
                  regex.test(t.function.description || '')
                );
              } catch (e) {
                throw new Error("Invalid Regex: " + e.message);
              }
            } else {
              // Simple BM25-like search (Keyword matching + ranking)
              const terms = query.toLowerCase().split(/\W+/).filter(t => t.length > 0);

              if (terms.length > 0) {
                results = activeTools.map(t => {
                  const nameTokens = t.function.name.toLowerCase().split(/\W+/);
                  const descTokens = (t.function.description || '').toLowerCase().split(/\W+/);
                  const docTokens = [...nameTokens, ...descTokens];

                  let score = 0;
                  // Simplified scoring:
                  // 1. Exact Name Match: High boost
                  if (t.function.name.toLowerCase().includes(query.toLowerCase())) score += 10;

                  for (const term of terms) {
                    // TF (Term Frequency)
                    const tf = docTokens.filter(dt => dt === term).length;
                    if (tf > 0) {
                      score += tf * 2; // Weight term matches
                    }
                    // Partial matches
                    if (docTokens.some(dt => dt.includes(term))) {
                      score += 0.5;
                    }
                  }
                  return { tool: t, score };
                })
                  .filter(r => r.score > 0)
                  .sort((a, b) => b.score - a.score)
                  .map(r => r.tool);
              }
            }
          }

          // Format response
          const response = results.map(t => ({
            name: t.function.name,
            description: t.function.description
          }));

          const responseMessage = `AVAILABLE TOOLS (${response.length} found):\n\n` +
            JSON.stringify(response, null, 2) +
            `\n\nThese are the available tools. Only use them if the user's request requires it. ` +
            `To learn how to use a tool, call getToolSchema with the tool name.`;

          pushMessage({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: responseMessage
          });

        } catch (err) {
          pushMessage({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            is_error: true,
            content: "Error: " + err.message
          });
        }
        continue;
      }


      if (call.function.name === 'evalCode') {
        try {
          const args = JSON.parse(call.function.arguments);
          const code = args.code;

          let result;
          try {
            if (useSafeEval.value) {
              // Use Worker
              const safeResult = await evalSafe(code);
              if (safeResult.success) {
                result = safeResult.result;
                // Maybe append logs if available?
                if (safeResult.logs && safeResult.logs.length > 0) {
                  // console.log("Worker Logs:", safeResult.logs);
                  // We could treat logs as part of the output if we wanted
                }
              } else {
                result = "Eval Error: " + safeResult.error;
              }
            } else {
              // Use new Function to allow 'return' statements and cleaner scope
              const func = new Function(code);
              result = func();
            }
          } catch (evalErr) {
            result = "Eval Error: " + evalErr.message;
          }
          console.log("evalCode result: ", result, args.code)

          const isError = typeof result === 'string' && result.startsWith("Eval Error:");

          pushMessage({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            is_error: isError // Internal flag
          });

          if (isError) {
            console.warn("Tool execution failed (evalCode). Stopping subsequent tool calls.");
            break; // Stop subsequent calls
          }

        } catch (err) {
          pushMessage({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: "Error: " + err.message,
            is_error: true
          });
          break; // Stop subsequent calls
        }
        continue;
      }

      const toolDef = activeTools.find(t => t.function.name === call.function.name);
      const server = mcpServers.find(s =>
        s.enabled &&
        s.status === 'connected' &&
        s.client.tools.some(t => t.function.name === call.function.name)
      );

      if (server && toolDef) {
        try {
          const args = JSON.parse(call.function.arguments);

          // Validate arguments against schema
          let validationError = null;
          if (toolDef.function.parameters) {
            const validate = ajv.compile(toolDef.function.parameters);
            const valid = validate(args);
            if (!valid) {
              validationError = ajv.errorsText(validate.errors);
            }
          }

          if (validationError) {
            console.warn(`Validation failed for tool ${call.function.name} in executeTools (checking safety net):`, validationError);
            console.log("Failed Args:", JSON.stringify(args, null, 2));
            console.log("Failed Schema:", JSON.stringify(toolDef.function.parameters, null, 2));

            const argsExample = generateExample(toolDef.function.parameters);
            const fullExample = {
              name: call.function.name,
              arguments: argsExample
            };
            pushMessage({
              role: "tool",
              tool_call_id: call.id,
              content: `Error: Invalid arguments: ${validationError}. \n\nExpected Schema:\n${JSON.stringify(toolDef.function.parameters, null, 2)}\n\nExpected Request Example Payload:\n${JSON.stringify(fullExample, null, 2)}\n\nPlease correct your input payload based on the schema and try again.`,
              name: call.function.name,
              is_error: true
            });
            break; // Stop subsequent calls
          } else {
            const result = await server.client.callTool(call.function.name, args);
            // Check if result is explicitly an error string? 
            // MCP tools might return text that *describes* an error but is technically a successful call.
            // But if the server threw an exception, it's caught below.
            // For now, assume successful execution unless it throws.

            // Check if result content indicates error?
            // "content": [{ "type": "text", "text": "..." }]
            // We'll proceed.
            pushMessage({
              role: "tool",
              tool_call_id: call.id,
              content: result,
              name: call.function.name
            });
          }
        } catch (err) {
          pushMessage({
            role: "tool",
            tool_call_id: call.id,
            content: "Error: " + err.message,
            name: call.function.name,
            is_error: true
          });
          break; // Stop subsequent calls
        }
      } else {
        pushMessage({
          role: "tool",
          tool_call_id: call.id,
          content: "Error: Tool not found on any connected server.",
          name: call.function.name,
          is_error: true
        });
        break; // Stop subsequent calls
      }
    }
    postChatToWorker();
  };

  const stop = () => {
    if (worker.value) {
      isModelLoading.value = true;
      isGenerating.value = false;
      worker.value.postMessage({ type: "stop" });
      pushMessage({ role: "assistant", content: "_Generation stopped. Reloading model to ensure a clean state..._" });
    }
  };

  const clearChat = async () => {
    console.log("clearChat called");
    try {
      stop(); // Ensure generation is stopped
      isGenerating.value = false; // Force reset state
      pendingToolCalls.value = null; // Clear pending approvals
      messages.value = [];
      console.log("Clearing DB...");
      await messageStore.clearMessages(); // WIPE DB
      console.log("DB Cleared");
    } catch (e) {
      console.error("clearChat failed:", e);
    }
  };

  onUnmounted(() => {
    if (worker.value) worker.value.terminate();
    mcpServers.forEach(s => {
      if (s.client) s.client.disconnect();
    });
  });

  messages.value = [];

  onMounted(() => {
    loadFromStorage();
    // initModel(); // Wait for user to start
  });

  const isChatStarted = ref(false);

  const startChat = async () => {
    isChatStarted.value = true;
    await initModel();
  };

  return {
    initModel,
    switchModel, // Exported function
    availableModels, // Exported list
    selectedModel, // Exported ref
    sendMessage,
    addServer,
    removeServer,
    toggleServer,
    approveToolCalls,
    cancelToolCalls,
    stop, // Exported function
    clearChat, // Exported function
    messages,
    mcpServers,
    isModelLoading,
    isGenerating,
    loadProgress,
    loadText,
    pendingToolCalls,
    isChatStarted,
    startChat,
    customSystemPrompt,
    useSafeEval,
    saveToStorage,
    resetSystemPrompt,
    updateProjectSystemPrompt,
    // --- Projects & Chats ---
    projects,
    currentProjectId,
    chats,
    activeChatId,
    activeChatTitle,
    loadProjects,
    selectProject,
    createProject,
    createEncryptedProject,
    unlockProject,
    lockProject,
    isProjectLocked,
    deleteProject,
    selectChat,
    createNewChat,
    deleteChat,
    renameChat,
    // --- Encrypted Project State ---
    isUnlockModalOpen,
    unlockingProjectId,
    unlockPassword,
    unlockError
  };
}