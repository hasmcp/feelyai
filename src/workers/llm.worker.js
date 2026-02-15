import { CreateMLCEngine, prebuiltAppConfig } from "@mlc-ai/web-llm";

let engine = null;
let interrupted = false;
let currentModelId = null;

// Helper: Standardize tool call format for WebLLM
const formatTools = (parsed) => {
  // Ensure it's an array
  const tools = Array.isArray(parsed) ? parsed : [parsed];

  return tools.map(tc => ({
    id: "call_" + Math.random().toString(36).slice(2),
    type: "function",
    function: {
      name: tc.name,
      // WebLLM requires arguments to be a string
      arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {})
    }
  }));
};

// Helper: Aggressively hunt for JSON inside a dirty string
const extractTools = (text) => {
  try {
    // 1. Clean up potential Markdown wrappers
    // Remove ```json ... ``` and ``` ... ```
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();

    // 2. STRATEGY A: Look for a JSON Array [...]
    const arrayMatch = cleanText.match(/\[([\s\S]*)\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name) {
          return formatTools(parsed);
        }
      } catch (e) { /* Continue */ }
    }

    // 3. STRATEGY B: Robust Parsing using Brace Counting
    // Handles single objects, nested objects, and multiple sequential objects
    const candidates = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let isEscaped = false;

    for (let i = 0; i < cleanText.length; i++) {
      const char = cleanText[i];

      if (inString) {
        if (char === '\\') {
          isEscaped = !isEscaped;
        } else if (char === '"' && !isEscaped) {
          inString = false;
        } else {
          isEscaped = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          const candidate = cleanText.substring(start, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            if (parsed.name) {
              candidates.push(parsed);
            }
          } catch (e) {
            // Failed to parse candidate, ignore
          }
          start = -1;
        }
      }
    }

    if (candidates.length > 0) {
      console.log("Worker: Extracted", candidates.length, "tool calls via brace counting.");
      return formatTools(candidates);
    }

    // 4. STRATEGY C: XML fallback (Keep existing)
    const xmlToolCallMatch = cleanText.match(/<(?:tool_code|tool_call)>(?<toolName>\w+)\((?<args>{[\s\S]*?})\)<\/(?:tool_code|tool_call)>/);
    if (xmlToolCallMatch && xmlToolCallMatch.groups) {
      try {
        const toolName = xmlToolCallMatch.groups.toolName;
        const argsString = xmlToolCallMatch.groups.args;
        const parsedArgs = JSON.parse(argsString);
        if (toolName && typeof parsedArgs === 'object') {
          return formatTools([{ name: toolName, arguments: parsedArgs }]);
        }
      } catch (e) {
        console.error("Worker: Error parsing XML-like tool call arguments:", e);
      }
    }
  } catch (e) {
    console.error("Error in extractTools:", e);
    return null;
  }

  return null;
};

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  try {
    if (type === "init") {
      currentModelId = payload.modelId; // Store the model ID

      // Clone the prebuilt config to avoid mutating global state if possible (though it's a module import)
      // We manually construct the AppConfig to include overrides for the specific model
      const myAppConfig = {
        ...prebuiltAppConfig,
        model_list: prebuiltAppConfig.model_list.map(m => {
          if (m.model_id === payload.modelId) {
            return {
              ...m,
              overrides: {
                ...(m.overrides || {}),
                context_window_size: -1,
                sliding_window_size: 4096,
                attention_sink_size: 4,
              }
            };
          }
          return m;
        })
      };

      engine = await CreateMLCEngine(payload.modelId, {
        initProgressCallback: (p) => {
          self.postMessage({ type: "progress", data: p });
        },
        appConfig: myAppConfig,
      });
      self.postMessage({ type: "ready" });
    }
    else if (type === "stop") {
      if (engine && currentModelId) {
        interrupted = true;
        console.log("Worker: Reloading engine to interrupt...");
        await engine.reload(currentModelId, {
          initProgressCallback: (p) => {
            self.postMessage({ type: "progress", data: p });
          },
          context_window_size: -1,
          sliding_window_size: 4096,
          attention_sink_size: 4,
        });
        console.log("Worker: Engine reloaded and ready.");
        self.postMessage({ type: "ready" });
      }
    }
    else if (type === "chat") {
      if (!engine) throw new Error("Engine not initialized");
      interrupted = false; // Reset for new generation

      try {
        // MANUAL TOOL PARSING APPROACH
        // We intentionally OMIT the 'tools' parameter here to prevent the engine's 
        // strict parser from throwing errors on malformed JSON (like single objects vs arrays).
        // We will parse the raw text response ourselves.
        const chunks = await engine.chat.completions.create({
          stream: true,
          messages: payload.messages,
          // tools: payload.tools  <-- REMOVED to bypass engine validation
        });

        let reply = null;
        let fullContent = "";

        for await (const chunk of chunks) {
          if (!reply) {
            reply = {
              id: chunk.id,
              choices: [{
                message: {
                  role: 'assistant',
                  content: "",
                  tool_calls: []
                }
              }]
            };
          }

          const delta = chunk.choices[0]?.delta;
          if (delta.content) {
            const content = delta.content;
            reply.choices[0].message.content += content;
            fullContent += content;

            // Pass partially accumulated text to main thread for streaming UI
            // We might want to throttle this or only send text updates
            self.postMessage({
              type: "progress",
              data: {
                // This is a bit hacky, reusing progress for streaming text? 
                // No, usually we send "chunk" messages. 
                // But the original code didn't seem to stream text back to UI in the loop?
                // Wait, it just built the reply.
                // Let's stick to building the reply first.
              }
            });
          }
        }

        if (interrupted) return;

        const message = reply.choices[0].message;

        // NOW we run our aggressive manual parser on the full generated text
        const extractedTools = extractTools(fullContent);

        if (extractedTools) {
          console.log("Worker: Manually extracted tools:", extractedTools);
          message.tool_calls = extractedTools;
          // If the text was JUST the JSON, clear the content so it looks like a proper tool call
          // Simple heuristic: if content is almost exactly the JSON, clear it.
          const jsonAsString = JSON.stringify(extractedTools); // approximates length
          if (fullContent.trim().startsWith("{") || fullContent.trim().startsWith("[")) {
            // likely just the tool call
            message.content = null;
          }
        } else {
          // No tools found, leave content as is
        }
        self.postMessage({ type: "complete", message: message });

      } catch (err) {
        if (interrupted) return; // Don't recover or post if interrupted

        const errorString = err.toString();

        // --- ATTEMPT 1: Tool Format Error Fallback ---
        // Catch "expect array" error AND "invalid JSON" SyntaxErrors from the engine
        if (errorString.includes("expect output of function calling to be an array") ||
          errorString.includes("is not valid JSON") ||
          errorString.includes("SyntaxError")) {
          // Verify if the output is actually JSON before warning
          // We will run the raw generation first, then check.
          try {
            const rawChunks = await engine.chat.completions.create({
              stream: true,
              messages: payload.messages,
              // Intentionally OMIT tools to get raw text
            });

            let fullText = "";
            const assistantMessage = {
              role: 'assistant',
              content: "",
              tool_calls: []
            };

            for await (const chunk of rawChunks) {
              const content = chunk.choices[0]?.delta?.content || "";
              fullText += content;
              assistantMessage.content += content;
            }

            // Check if the output is JSON
            let isJson = false;
            try {
              const parsed = JSON.parse(fullText);
              // If it parses and is an object or array, it's JSON.
              if (typeof parsed === 'object' && parsed !== null) isJson = true;
            } catch (e) {
              // Not JSON
            }

            // If it is NOT JSON, it's likely just a conversational response that got flagged by strict parser.
            // If it IS JSON, it might be a malformed tool call that the engine rejected.
            if (isJson) {
              const parsed = JSON.parse(fullText);
              if (typeof parsed === 'object' && parsed.name && parsed.arguments) {
                console.log("Worker: Recovered single tool call object (wrapped in array).");
                const argsString = typeof parsed.arguments === 'string'
                  ? parsed.arguments
                  : JSON.stringify(parsed.arguments);

                assistantMessage.tool_calls = [{
                  id: 'call_' + Math.random().toString(36).substr(2, 9),
                  function: {
                    name: parsed.name,
                    arguments: argsString
                  },
                  type: 'function'
                }];
                assistantMessage.content = null;
              } else {
                console.warn("Worker: Engine tool parsing failed, but raw output IS valid JSON. Likely a structure mismatch (expected array). Error:", errorString);
              }
            } else {
              console.debug("Worker: Engine tool parsing failed. Output is text (not JSON), falling back to conversation. Error:", errorString);
            }

            // Attempt to extract tools from the full raw text if not already recovered
            if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
              const extracted = extractTools(fullText);
              console.log("Fallback extracted tools:", extracted);
              if (extracted) {
                assistantMessage.tool_calls = extracted;
                assistantMessage.content = null;
              }
            }

            self.postMessage({ type: "complete", message: assistantMessage });
            return;

          } catch (fallbackErr) {
            console.error("Worker: Fallback detailed error:", fallbackErr);
            // Verify if engine needs reload?
          }
        }

        // --- ATTEMPT 2: Crash Recovery ---

        // Match everything after "Got outputMessage:"
        const match = errorString.match(/Got outputMessage:\s*([\s\S]*)/);

        if (match && match[1]) {
          const rawOutput = match[1].trim();
          console.warn("Worker: Recovering from engine crash. Raw output:", rawOutput);

          // Fallback: Just return the raw text. Tool recovery from crash is disabled.
          self.postMessage({
            type: "complete",
            message: {
              role: "assistant",
              content: rawOutput
            }
          });
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      error: err.message || "Unknown worker error"
    });
  }
};
