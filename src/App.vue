<script setup>
import { ref, nextTick, watch } from 'vue';
import { useChat } from './composables/useChat';
import MarkdownIt from 'markdown-it';
import {
  Send, Bot, Trash2, Terminal,
  Loader2, ShieldCheck, XCircle, Square
} from 'lucide-vue-next';
import AddServerModal from './components/AddServerModal.vue';
import ProjectSidebar from './components/ProjectSidebar.vue';

const {
  sendMessage, addServer,
  approveToolCalls, cancelToolCalls,
  messages, isModelLoading, isGenerating, stop,
  loadProgress, loadText, pendingToolCalls, isChatStarted, startChat,
  customSystemPrompt, saveToStorage, resetSystemPrompt, updateProjectSystemPrompt,
  useSafeEval,
  // New
  activeChatTitle, availableModels, selectedModel, currentProjectId, projects
} = useChat();

const isSettingsOpen = ref(false);
const isAddServerOpen = ref(false);
const webGpuSupported = ref(true);

const userInput = ref("");
const chatScroll = ref(null);
const md = new MarkdownIt({ html: true });

import { onMounted } from 'vue';

onMounted(() => {
  if (!navigator.gpu) {
    webGpuSupported.value = false;
  }
});

watch(messages, async () => {
  await nextTick();
  if (chatScroll.value) {
    chatScroll.value.scrollTop = chatScroll.value.scrollHeight;
  }
}, { deep: true });

const onSend = () => {
  if (!userInput.value.trim() || isGenerating.value) return;
  sendMessage(userInput.value);
  userInput.value = "";
};

const handleAddServer = (serverData) => {
  addServer(serverData.url, true, serverData.name, serverData.headers);
  isAddServerOpen.value = false;
};
</script>

<template>
  <div class="flex h-screen bg-gray-950 text-gray-100 antialiased font-sans overflow-hidden">

    <AddServerModal 
      :isOpen="isAddServerOpen" 
      @close="isAddServerOpen = false"
      @add-server="handleAddServer"
    />

    <div v-if="pendingToolCalls" class="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style="background-color: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px);">
      <div class="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 overflow-hidden">
        <div class="flex items-center gap-3 mb-6 text-emerald-400">
          <ShieldCheck class="size-6" />
          <h3 class="text-xl font-bold text-white tracking-tight">Approve Tool Use</h3>
        </div>

        <div class="space-y-4 mb-8 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
          <p class="text-gray-400 text-sm">The AI requested to execute:</p>
          <div v-for="call in pendingToolCalls.calls" :key="call.id"
            class="bg-black rounded-xl p-4 border border-gray-800">
            <div class="flex items-center gap-2 mb-2 text-emerald-400 font-mono text-xs uppercase tracking-widest">
              <Terminal class="size-3" />
              {{ call.function.name }}
            </div>
            <pre
              class="text-[11px] text-gray-400 font-mono leading-relaxed overflow-x-auto">{{ JSON.parse(call.function.arguments) }}</pre>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <button @click="approveToolCalls('once')"
            class="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all">Allow
            Once</button>
          <div class="grid grid-cols-2 gap-3">
            <button @click="approveToolCalls('session')"
              class="py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-xs font-medium transition-all">Allow
              for Session</button>
            <button @click="approveToolCalls('always')"
              class="py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-xs font-medium transition-all">Always
              Allow</button>
          </div>
          <button @click="cancelToolCalls"
            class="flex items-center justify-center gap-2 w-full py-2 text-gray-500 hover:text-red-400 text-xs transition-colors mt-2">
            <XCircle class="size-3" /> Deny Execution
          </button>
        </div>
      </div>
    </div>

    <!-- System Instructions Modal -->
    <div v-if="isSettingsOpen" class="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style="background-color: rgba(0, 0, 0, 0.8); backdrop-filter: blur(4px);">
      <div class="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 flex flex-col h-[36vh]">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h3 class="text-xl font-bold text-white tracking-tight">System Instructions</h3>
            <p v-if="currentProjectId" class="text-xs text-gray-500 mt-1">
              Project: {{ projects.find(p => p.id === currentProjectId)?.name || 'Unknown' }}
            </p>
          </div>
          <button @click="isSettingsOpen = false" class="text-gray-400 hover:text-white transition-colors">
            <XCircle class="size-6" />
          </button>
        </div>

        <div class="flex-1 flex flex-col min-h-0 mb-6">
          <textarea v-model="customSystemPrompt" 
            placeholder="Customize system prompt... Use {{listTools}} to inject tools."
            class="w-full flex-1 bg-gray-950 border border-gray-800 rounded-xl px-4 py-4 text-sm focus:ring-1 focus:ring-emerald-500 outline-none placeholder-gray-600 resize-none font-mono leading-relaxed custom-scrollbar text-gray-300"
          ></textarea>

          <div class="mt-4 flex items-center justify-between bg-gray-950/50 p-3 rounded-xl border border-gray-800">
            <div class="flex items-center gap-3">
              <div class="p-2 bg-emerald-500/10 rounded-lg">
                <ShieldCheck class="size-4 text-emerald-500" />
              </div>
              <div class="text-sm">
                <h4 class="font-medium text-gray-200">Safe Eval Mode</h4>
                <p class="text-xs text-gray-500">Run code in isolated Worker (Recommended)</p>
              </div>
            </div>
            
            <button 
              @click="useSafeEval = !useSafeEval; saveToStorage()"
              class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
              :class="useSafeEval ? 'bg-emerald-600' : 'bg-gray-700'"
            >
              <span 
                class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                :class="useSafeEval ? 'translate-x-5' : 'translate-x-0'"
              ></span>
            </button>
          </div>
        </div>

        <div class="flex justify-between items-center pt-4 border-t border-gray-800">
          <button @click="resetSystemPrompt" class="text-xs text-red-400 hover:text-red-300 font-medium flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-900/20 transition-all">
            <Trash2 class="size-3" /> Reset to Default
          </button>
          
          <button @click="updateProjectSystemPrompt(customSystemPrompt); isSettingsOpen = false" 
            class="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-900/20">
            Save & Close
          </button>
        </div>
      </div>
    </div>

    <!-- START SCREEN -->
    <div v-if="!isChatStarted" class="flex-1 flex flex-col items-center justify-center p-8 bg-gray-950 relative overflow-hidden">
        <!-- Background Effects -->
        <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-900/20 via-gray-950 to-gray-950"></div>
        
        <div class="relative z-10 max-w-2xl w-full text-center space-y-12">
            <div class="space-y-6">
                <!-- LOGO/Intro -->
                <div class="inline-flex items-center justify-center p-4 bg-emerald-500/10 rounded-3xl mb-4 border border-emerald-500/20">
                    <img src="/favicon.svg" class="size-16" alt="Logo" />
                </div>
                <h1 class="text-6xl font-bold tracking-tight text-white mb-4">
                    FeelyAI
                </h1>
                <p class="text-xl text-gray-400 max-w-lg mx-auto leading-relaxed">
                    Run advanced AI models directly in your browser. Private, secure, and purely local.
                </p>

                <!-- Model Selection & Start -->
                <div class="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-3xl p-8 shadow-2xl space-y-6 max-w-md mx-auto">
                    <div class="space-y-2 text-left">
                        <label class="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">Select Model</label>
                        <div class="relative group">
                            <select v-model="selectedModel" 
                                class="w-full bg-black/50 border border-gray-700 text-white text-lg rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 block p-4 pr-10 appearance-none cursor-pointer transition-all hover:border-gray-600">
                                <option v-for="model in availableModels" :key="model.id" :value="model.id">
                                    {{ model.name }}
                                </option>
                            </select>
                             <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-400 group-hover:text-white transition-colors">
                                <svg class="fill-current h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    <button @click="startChat" 
                        class="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-lg shadow-lg shadow-emerald-900/20 transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-3">
                        <span>Start Chat</span>
                        <Send class="size-5" />
                    </button>
                </div>
            </div>
             <div class="text-sm text-gray-600 font-medium pt-8">
                Powered by Web-LLM &bull; No Server Costs &bull; 100% Client-Side
            </div>
        </div>
    </div>

    <!-- CHAT INTERFACE -->
    <template v-else>
      <ProjectSidebar 
        :isSettingsOpen="isSettingsOpen"
        :isAddServerOpen="isAddServerOpen"
        @open-settings="isSettingsOpen = true"
        @open-add-server="isAddServerOpen = true"
      />

      <main class="flex-1 flex flex-col relative bg-gray-950 min-w-0">
        <!-- Chat Header -->
        <div class="h-14 border-b border-gray-800 flex items-center px-6 bg-gray-950/50 backdrop-blur-sm sticky top-0 z-10">
            <h2 class="font-bold text-gray-200 truncate">{{ activeChatTitle }}</h2>
        </div>

        <div v-if="isModelLoading"
          class="absolute inset-x-0 top-14 bottom-0 z-50 bg-gray-950 flex flex-col items-center justify-center p-8">
          <div class="w-full max-w-md space-y-6 text-center">
            <Loader2 class="size-12 animate-spin text-emerald-500 mx-auto" />
            <div class="space-y-2">
              <h2 class="text-2xl font-bold text-white">Loading AI Model</h2>
              <p class="text-gray-400 text-sm">Downloading & Initializing Weights...</p>
            </div>
            <div class="bg-gray-800 rounded-full h-2 overflow-hidden">
              <div class="bg-emerald-500 h-full transition-all duration-300" :style="{ width: `${loadProgress * 100}%` }">
              </div>
            </div>
            <p class="text-[10px] text-gray-500 font-mono tracking-widest uppercase">{{ loadText }}</p>
          </div>
        </div>

        <div ref="chatScroll" class="flex-1 overflow-y-auto p-6 md:p-12 space-y-8 custom-scrollbar scroll-smooth">
          <div v-for="(m, i) in messages" :key="i" class="max-w-3xl mx-auto">
            <div v-if="m.role === 'user'" class="flex justify-end">
              <div class="bg-emerald-600 text-white px-5 py-3 rounded-2xl rounded-tr-none shadow-lg">{{ m.content }}</div>
            </div>
            <div v-else class="flex gap-4">
              <div
                class="size-8 rounded-lg bg-emerald-600/20 flex items-center justify-center flex-shrink-0 border border-emerald-500/20 mt-1">
                <Bot v-if="m.role === 'assistant'" class="size-5 text-emerald-400" />
                <Terminal v-else class="size-4 text-blue-400" />
              </div>
              <div class="flex-1 min-w-0 prose prose-invert prose-emerald text-gray-200 max-w-none break-words">
                <div v-if="m.role === 'tool'"
                  class="bg-black/50 border border-gray-800 rounded-xl font-mono text-xs whitespace-pre-wrap leading-relaxed break-all" style="overflow-x: auto; max-width: 100%;">
                  <details class="cursor-pointer">
                    <summary class="p-4 text-[10px] text-blue-400 font-bold uppercase tracking-widest opacity-80 hover:opacity-100 transition-opacity">
                      Output: {{ m.name }}
                    </summary>
                    <div class="p-4 pt-0 border-t border-gray-800/50 mt-2">
                      {{ m.content }}
                    </div>
                  </details>
                </div>
                <div v-else>
                  <!-- Tool Calls (Inputs) -->
                  <div v-if="m.tool_calls && m.tool_calls.length" class="mb-4 space-y-2">
                    <div v-for="call in m.tool_calls" :key="call.id" 
                      class="bg-gray-900/50 border border-gray-700/50 rounded-xl overflow-hidden">
                      <div class="flex items-center gap-2 px-3 py-2 bg-gray-800/30 border-b border-gray-700/30">
                        <Terminal class="size-3 text-purple-400" />
                        <span class="text-xs font-bold text-gray-300 font-mono">Tool Call: {{ call.function.name }}</span>
                      </div>
                      <div class="p-3 bg-black/20 overflow-x-auto">
                        <pre class="text-[10px] text-gray-400 font-mono leading-relaxed whitespace-pre-wrap break-all">{{ call.function.arguments }}</pre>
                      </div>
                    </div>
                  </div>
                  <!-- Message Content -->
                  <div v-if="m.content" v-html="md.render(m.content)"></div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="isGenerating"
            class="max-w-3xl mx-auto flex gap-4 text-gray-500 animate-pulse font-medium text-sm items-center">
            <Bot class="size-5" /> <span>AI is thinking...</span>
          </div>
        </div>

        <div class="p-5 border-t border-gray-800 bg-gray-900">
          <div
            class="max-w-3xl mx-auto relative flex items-center bg-gray-800 border border-gray-700 rounded-2xl focus-within:border-emerald-500/50 transition-all px-4 py-2 shadow-xl">
            <textarea v-model="userInput" @keydown.enter.prevent="onSend" placeholder="Ask a question or use a tool..."
              class="flex-1 bg-transparent border-none outline-none resize-none py-2 h-12 max-h-32 text-sm placeholder-gray-500 text-gray-100" :disabled="isModelLoading" />
            
            <button v-if="!isGenerating" @click="onSend" :disabled="!userInput.trim() || isModelLoading"
              class="p-2.5 bg-emerald-600 rounded-xl hover:bg-emerald-500 disabled:opacity-50 transition-all cursor-pointer">
              <Send class="size-4 text-white" />
            </button>
            <button v-else @click="stop"
              class="p-2.5 bg-red-600 rounded-xl hover:bg-red-500 transition-all cursor-pointer">
              <Square class="size-4 text-white" />
            </button>
          </div>
          <div class="text-[10px] text-center text-gray-600 mt-3 font-medium tracking-wide space-y-1">
            <div>WEBLLM + MCP PROTOCOL • PRIVATE & SECURE</div>
            <div class="text-gray-700">AI can make mistakes. Usage of LLM models subject to their license agreements.</div>
          </div>
        </div>
      </main>
    </template>
  </div>
</template>

<style>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

.prose p {
  margin-bottom: 1em;
}

.prose pre {
  background-color: rgba(0, 0, 0, 0.5) !important;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.5rem;
  padding: 1rem;
  white-space: pre-wrap;
  word-break: break-word;
}

.prose code {
  color: #34d399;
  background: rgba(0, 0, 0, 0.3);
  padding: 0.2em 0.4em;
  border-radius: 0.25em;
  font-size: 0.9em;
}

.prose pre code {
  background: transparent;
  padding: 0;
  color: inherit;
}
</style>