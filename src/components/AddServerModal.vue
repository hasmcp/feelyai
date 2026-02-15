<script setup>
import { ref } from 'vue';
import { XCircle, Plus, Trash2 } from 'lucide-vue-next';
import McpIcon from './McpIcon.vue';

const props = defineProps(['isOpen']);
const emit = defineEmits(['close', 'add-server']);

const newUrl = ref("");
const newName = ref("");
const headerPairs = ref([]);

const addHeader = () => {
  headerPairs.value.push({ key: "", value: "" });
};

const removeHeader = (index) => {
  headerPairs.value.splice(index, 1);
};

const handleAddServer = () => {
  if (!newUrl.value.trim()) return;

  const headers = headerPairs.value.reduce((acc, pair) => {
    if (pair.key.trim()) acc[pair.key.trim()] = pair.value.trim();
    return acc;
  }, {});
  
  emit('add-server', {
    url: newUrl.value.trim(),
    name: newName.value.trim(),
    headers
  });

  // Reset form
  newUrl.value = "";
  newName.value = "";
  headerPairs.value = [];
  emit('close');
};
</script>

<template>
  <div v-if="isOpen" class="fixed inset-0 z-[100] flex items-center justify-center p-4"
    style="background-color: rgba(0, 0, 0, 0.8); backdrop-filter: blur(4px);">
    <div class="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 overflow-hidden">
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-3 text-emerald-400">
          <McpIcon class="size-6" />
          <h3 class="text-xl font-bold text-white tracking-tight">Add MCP Server</h3>
        </div>
        <button @click="$emit('close')" class="text-gray-400 hover:text-white transition-colors">
          <XCircle class="size-6" />
        </button>
      </div>

      <div class="space-y-4">
        <div>
          <label class="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Server URL</label>
          <input v-model="newUrl" placeholder="http://localhost:8000/sse"
            class="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-sm focus:ring-1 focus:ring-emerald-500 outline-none placeholder-gray-600 text-white"
            @keyup.enter="handleAddServer">
        </div>

        <div>
          <label class="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Name (Optional)</label>
          <input v-model="newName" placeholder="My Server"
            class="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-sm focus:ring-1 focus:ring-emerald-500 outline-none placeholder-gray-600 text-white">
        </div>

        <div>
          <label class="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Headers (Optional)</label>
          <div class="space-y-2">
            <div v-for="(pair, index) in headerPairs" :key="index" class="flex gap-2">
              <input v-model="pair.key" placeholder="Key (e.g. Authorization)" 
                class="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500 outline-none placeholder-gray-600 font-mono text-gray-300">
              <input v-model="pair.value" placeholder="Value (e.g. Bearer token)" 
                class="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500 outline-none placeholder-gray-600 font-mono text-gray-300">
              <button @click="removeHeader(index)" class="text-gray-500 hover:text-red-400 px-1">
                <Trash2 class="size-4" />
              </button>
            </div>
            <button @click="addHeader" class="text-xs flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors font-medium py-1">
              <Plus class="size-3" /> Add Header Pair
            </button>
          </div>
        </div>
      </div>

      <div class="mt-8 flex justify-end">
        <button @click="handleAddServer" 
          class="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-900/20 flex items-center gap-2">
          <Plus class="size-4" />
          Add Server
        </button>
      </div>
    </div>
  </div>
</template>
