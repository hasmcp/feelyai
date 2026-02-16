<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useChat } from '../composables/useChat';
import { 
  Folder, MessageSquare, Plus, ChevronRight, ChevronDown, 
  MoreHorizontal, Trash2, Edit2, Settings, Monitor, GripVertical, Cpu,
  Menu, X, PanelLeftClose, PanelLeft
} from 'lucide-vue-next';

// Use the shared composable
const { 
  projects, currentProjectId, chats, activeChatId, 
  loadProjects, selectProject, createProject, deleteProject,
  selectChat, createNewChat, deleteChat, renameChat,
  selectedModel, availableModels, switchModel,
  mcpServers, addServer, removeServer, toggleServer,
  customSystemPrompt, updateProjectSystemPrompt, resetSystemPrompt
} = useChat();

const expandedProjects = ref(new Set());
const isNewProjectModalOpen = ref(false);
const newProjectName = ref("");
const editingChatId = ref(null);
const editChatTitle = ref("");
const isSystemPromptModalOpen = ref(false);
const editingSystemPrompt = ref("");

// Tooltip state
const hoveredProject = ref(null);
const tooltipPosition = ref({ x: 0, y: 0 });

// Responsive sidebar state
const isSidebarCollapsed = ref(false);
const isMobileMenuOpen = ref(false);
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024);

const isMobile = computed(() => windowWidth.value < 768);

// Load sidebar state from localStorage
const loadSidebarState = () => {
  const saved = localStorage.getItem('sidebar_collapsed');
  if (saved !== null) {
    isSidebarCollapsed.value = saved === 'true';
  }
};

// Save sidebar state to localStorage
const saveSidebarState = () => {
  localStorage.setItem('sidebar_collapsed', String(isSidebarCollapsed.value));
};

// Toggle sidebar collapse (desktop)
const toggleSidebarCollapse = () => {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
  saveSidebarState();
};

// Toggle mobile menu
const toggleMobileMenu = () => {
  isMobileMenuOpen.value = !isMobileMenuOpen.value;
};

// Close mobile menu
const closeMobileMenu = () => {
  isMobileMenuOpen.value = false;
};

// Handle window resize
const handleResize = () => {
  windowWidth.value = window.innerWidth;
  // Auto-close mobile menu when switching to desktop
  if (!isMobile.value) {
    isMobileMenuOpen.value = false;
  }
};

// Props for communication with parent
const props = defineProps({
  isSettingsOpen: Boolean,
  isAddServerOpen: Boolean
});

const emit = defineEmits(['open-settings', 'open-add-server', 'toggle-mobile-menu']);

// Toggle project expansion
const toggleProject = (projectId) => {
  if (expandedProjects.value.has(projectId)) {
    expandedProjects.value.delete(projectId);
  } else {
    // For now, simple single-active project or multi-expand?
    // Let's allow multi-expand but auto-select the project on click
    expandedProjects.value.add(projectId);
    selectProject(projectId);
  }
  
  // Close mobile menu after selection
  if (isMobile.value) {
    closeMobileMenu();
  }
};

// Auto-expand current project on load
const init = async () => {
    // Wait for data? 
    if (currentProjectId.value) {
        expandedProjects.value.add(currentProjectId.value);
    }
};

const handleCreateProject = async () => {
  if (!newProjectName.value.trim()) return;
  await createProject(newProjectName.value);
  newProjectName.value = "";
  isNewProjectModalOpen.value = false;
};

const startEditing = (chat) => {
    editingChatId.value = chat.id;
    editChatTitle.value = chat.title;
};

const saveChatTitle = async () => {
    if (editingChatId.value && editChatTitle.value.trim()) {
        await renameChat(editingChatId.value, editChatTitle.value);
    }
    editingChatId.value = null;
};

const openSystemPromptEditor = () => {
    editingSystemPrompt.value = customSystemPrompt.value;
    isSystemPromptModalOpen.value = true;
};

const saveSystemPrompt = async () => {
    await updateProjectSystemPrompt(editingSystemPrompt.value);
    isSystemPromptModalOpen.value = false;
};

const resetToDefault = async () => {
    await resetSystemPrompt();
    editingSystemPrompt.value = customSystemPrompt.value;
};

const handleSelectChat = async (chatId) => {
  await selectChat(chatId);
  // Close mobile menu after selection
  if (isMobile.value) {
    closeMobileMenu();
  }
};

// Tooltip handlers
const showTooltip = (event, project) => {
  if (!isSidebarCollapsed.value) return;
  hoveredProject.value = project;
  const rect = event.currentTarget.getBoundingClientRect();
  tooltipPosition.value = {
    x: rect.right + 8,
    y: rect.top + (rect.height / 2)
  };
};

const hideTooltip = () => {
  hoveredProject.value = null;
};

onMounted(() => {
  loadSidebarState();
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
});

// Expose functions to parent component
defineExpose({
  toggleMobileMenu
});

// MCP & Model logic borrowed from Sidebar
</script>

<template>
  <!-- Mobile Backdrop -->
  <div 
    v-if="isMobile && isMobileMenuOpen" 
    @click="closeMobileMenu"
    class="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
  ></div>

  <aside 
    :class="[
      'border-r border-gray-800 flex flex-col bg-gray-950 transition-all duration-300',
      // Desktop: collapsible sidebar
      !isMobile && isSidebarCollapsed ? 'w-16' : 'w-80',
      // Mobile: fixed overlay drawer
      isMobile ? 'fixed inset-y-0 left-0 z-50 transform' : 'flex-shrink-0',
      isMobile && !isMobileMenuOpen ? '-translate-x-full' : 'translate-x-0'
    ]"
  >
    <!-- Header / Branding -->
    <div class="h-14 px-4 border-b border-gray-800 flex items-center gap-3 shrink-0 justify-between">
        <div v-if="isMobile || !isSidebarCollapsed" class="flex items-center gap-3 min-w-0">
            <div class="bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/20 flex-shrink-0">
                <img src="/favicon.svg" class="size-5" alt="Logo" />
            </div>
            <h1 class="font-bold text-lg tracking-tight text-white truncate">FeelyAI</h1>
        </div>
        
        <!-- Desktop: Collapse Toggle -->
        <button 
            v-if="!isMobile"
            @click="toggleSidebarCollapse" 
            class="text-gray-400 hover:text-white transition-colors flex-shrink-0"
            :title="isSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'"
        >
            <PanelLeftClose v-if="!isSidebarCollapsed" class="size-5" />
            <PanelLeft v-else class="size-5" />
        </button>
        
        <!-- Mobile: Close Button -->
        <button 
            v-if="isMobile"
            @click="closeMobileMenu" 
            class="text-gray-400 hover:text-white transition-colors flex-shrink-0"
        >
            <X class="size-5" />
        </button>
    </div>

    <!-- Projects & Chats List -->
    <div class="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-6">
        
        <!-- Projects Section -->
        <div class="space-y-1">
            <div v-if="isMobile || !isSidebarCollapsed" class="flex items-center justify-between px-2 mb-2">
                <h2 class="text-xs font-bold text-gray-500 uppercase tracking-wider">Projects</h2>
                <button @click="isNewProjectModalOpen = true" class="text-gray-500 hover:text-emerald-400 transition-colors">
                    <Plus class="size-4" />
                </button>
            </div>
            <div v-else class="flex justify-center mb-2">
                <button @click="isNewProjectModalOpen = true" class="text-gray-500 hover:text-emerald-400 transition-colors p-2" title="New Project">
                    <Plus class="size-4" />
                </button>
            </div>

            <div v-for="project in projects" :key="project.id" class="space-y-1">
                <!-- Project Item -->
                <div 
                    @click="toggleProject(project.id)"
                    @mouseenter="(e) => showTooltip(e, project)"
                    @mouseleave="hideTooltip"
                    :class="[
                        'group flex items-center gap-2 rounded-lg cursor-pointer transition-colors select-none relative',
                        (isMobile || !isSidebarCollapsed) ? 'px-3 py-2' : 'px-2 py-2 justify-center',
                        currentProjectId === project.id ? 'bg-gray-900 text-emerald-400' : 'hover:bg-gray-900 text-gray-400'
                    ]"
                >
                    <component v-if="isMobile || !isSidebarCollapsed" :is="expandedProjects.has(project.id) ? ChevronDown : ChevronRight" class="size-3.5 opacity-75" />
                    <Folder class="size-4" :class="currentProjectId === project.id ? 'fill-emerald-400/20' : ''" />
                    <span v-if="isMobile || !isSidebarCollapsed" class="text-sm font-medium truncate flex-1">{{ project.name }}</span>
                    
                    <div 
                        v-if="isMobile || !isSidebarCollapsed" 
                        :class="[
                            'flex items-center gap-1',
                            isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        ]"
                    >
                        <button 
                            v-if="currentProjectId === project.id"
                            @click.stop="openSystemPromptEditor" 
                            class="hover:bg-blue-500/20 hover:text-blue-400 p-1 rounded transition-all"
                            title="Edit System Prompt"
                        >
                            <Cpu class="size-3.5" />
                        </button>
                        <button 
                            @click.stop="deleteProject(project.id)" 
                            class="hover:bg-red-500/20 hover:text-red-400 p-1 rounded transition-all"
                            title="Delete Project"
                        >
                            <Trash2 class="size-3.5" />
                        </button>
                        <button 
                            v-if="currentProjectId === project.id"
                            @click.stop="createNewChat" 
                            class="hover:bg-emerald-500/20 hover:text-emerald-400 p-1 rounded transition-all"
                            title="New Chat"
                        >
                            <Plus class="size-3.5" />
                        </button>
                    </div>
                </div>

                <!-- Chats List (for this project) -->
                <div v-if="expandedProjects.has(project.id) && (isMobile || !isSidebarCollapsed)" class="pl-4 space-y-0.5 border-l border-gray-800 ml-5">
                    <div 
                        v-for="chat in (project.id === currentProjectId ? chats : [])" 
                        :key="chat.id"
                        class="group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors relative"
                        :class="activeChatId === chat.id ? 'bg-emerald-500/10 text-emerald-400' : 'hover:bg-gray-900 text-gray-400'"
                        @click="handleSelectChat(chat.id)"
                    >
                        <MessageSquare class="size-3.5 opacity-70" />
                        
                        <!-- Title or Edit Input -->
                        <div v-if="editingChatId === chat.id" class="flex-1">
                            <input 
                                v-model="editChatTitle" 
                                @blur="saveChatTitle" 
                                @keydown.enter.prevent="saveChatTitle"
                                class="w-full bg-black border border-emerald-500 rounded px-1 py-0.5 text-xs text-white outline-none"
                                autoFocus
                            />
                        </div>
                        <span v-else class="truncate flex-1">{{ chat.title }}</span>

                        <!-- Chat Actions -->
                        <div class="hidden group-hover:flex items-center gap-1 absolute right-2 bg-gray-900 shadow-xl pl-2 rounded-l-lg">
                            <button @click.stop="startEditing(chat)" class="p-1 hover:text-white transition-colors">
                                <Edit2 class="size-3" />
                            </button>
                            <button @click.stop="deleteChat(chat.id)" class="p-1 hover:text-red-400 transition-colors">
                                <Trash2 class="size-3" />
                            </button>
                        </div>
                    </div>
                    <div v-if="project.id === currentProjectId && chats.length === 0" class="px-4 py-2 text-xs text-gray-600 italic">
                        No chats yet.
                    </div>
                </div>
            </div>
        </div>

        <!-- MCP Servers (Moved from App.vue) -->
        <div v-if="isMobile || !isSidebarCollapsed" class="pt-6 border-t border-gray-800">
             <div class="flex items-center justify-between px-2 mb-3">
                <h2 class="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                    <Monitor class="size-3" /> MCP Servers
                </h2>
                <button @click="emit('open-add-server')" class="text-gray-500 hover:text-emerald-400 transition-colors">
                    <Plus class="size-4" />
                </button>
            </div>
            
            <div class="space-y-2">
                 <div v-for="s in mcpServers" :key="s.id"
                    class="p-2.5 rounded-lg border border-gray-800 bg-gray-900/40 group hover:border-gray-700 transition-all">
                    <div class="flex items-center justify-between mb-1.5">
                        <span class="text-xs font-bold text-gray-300 truncate">{{ s.name || 'Unnamed' }}</span>
                        <div class="flex gap-1.5">
                             <button @click="toggleServer(s.id)" :class="s.enabled ? 'text-emerald-400' : 'text-gray-600'">
                                <div class="size-2 rounded-full" :class="s.enabled ? 'bg-emerald-500' : 'bg-gray-700'"></div>
                            </button>
                            <button @click="removeServer(s.id)" class="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Trash2 class="size-3" />
                            </button>
                        </div>
                    </div>
                    <div class="flex items-center justify-between">
                         <span class="text-[10px] text-gray-500 font-mono truncate max-w-[120px]">{{ s.url }}</span>
                         <span v-if="s.toolCount" class="text-[9px] bg-gray-800 px-1.5 py-0.5 rounded text-emerald-400/80 font-mono">{{ s.toolCount }} tools</span>
                    </div>
                </div>
            </div>
        </div>

    </div>

    <!-- Footer / Model Selector -->
    <div v-if="isMobile || !isSidebarCollapsed" class="p-6 border-t border-gray-800 bg-gray-900/50">
        <div class="mb-3">
            <label class="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Active Model</label>
             <div class="relative">
                <select :value="selectedModel" @change="switchModel($event.target.value)"
                    class="w-full bg-gray-950 border border-gray-800 text-gray-300 text-xs rounded-lg focus:ring-emerald-500 focus:border-emerald-500 block p-2.5 appearance-none cursor-pointer hover:border-gray-700 transition-colors">
                    <option v-for="model in availableModels" :key="model.id" :value="model.id">
                        {{ model.name }}
                    </option>
                </select>
                 <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                    <ChevronDown class="size-3.5" />
                </div>
            </div>
        </div>
        <button @click="emit('open-settings')" class="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-white transition-all text-sm">
            <Settings class="size-4" />
            <span>Settings</span>
        </button>
    </div>

    <!-- Footer Collapsed Mode -->
    <div v-if="!isMobile && isSidebarCollapsed" class="p-3 border-t border-gray-800 bg-gray-900/50 flex justify-center">
        <button 
            @click="emit('open-settings')" 
            class="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-all"
            title="Settings"
        >
            <Settings class="size-5" />
        </button>
    </div>

    <!-- New Project Modal -->
    <div v-if="isNewProjectModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div class="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h3 class="text-lg font-bold text-white mb-4">Create New Project</h3>
            <input 
                v-model="newProjectName" 
                placeholder="Project Name"
                class="w-full bg-black border border-gray-700 rounded-lg px-4 py-2 text-white mb-4 focus:ring-1 focus:ring-emerald-500 outline-none"
                @keydown.enter="handleCreateProject"
                autoFocus
            />
            <div class="flex justify-end gap-2">
                <button @click="isNewProjectModalOpen = false" class="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
                <button @click="handleCreateProject" class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold">Create</button>
            </div>
        </div>
    </div>

    <!-- System Prompt Modal -->
    <div v-if="isSystemPromptModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div class="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-2xl shadow-2xl flex flex-col" style="max-height: 80vh;">
            <div class="mb-4">
                <h3 class="text-lg font-bold text-white">Edit System Prompt</h3>
                <p class="text-xs text-gray-500 mt-1">
                    Project: {{ projects.find(p => p.id === currentProjectId)?.name || 'Unknown' }}
                </p>
            </div>
            
            <textarea 
                v-model="editingSystemPrompt" 
                placeholder="Customize system prompt... Use {{listTools}} to inject tools."
                class="w-full flex-1 bg-black border border-gray-700 rounded-lg px-4 py-3 text-sm text-white mb-4 focus:ring-1 focus:ring-emerald-500 outline-none placeholder-gray-600 resize-none font-mono leading-relaxed"
                style="min-height: 300px;"
            ></textarea>

            <div class="flex justify-between items-center pt-4 border-t border-gray-800">
                <button @click="resetToDefault" class="text-xs text-red-400 hover:text-red-300 font-medium flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-900/20 transition-all">
                    <Trash2 class="size-3" /> Reset to Default
                </button>
                
                <div class="flex gap-2">
                    <button @click="isSystemPromptModalOpen = false" class="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
                    <button @click="saveSystemPrompt" class="px-6 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold">Save</button>
                </div>
            </div>
        </div>
    </div>
  </aside>

  <!-- Custom Tooltip -->
  <Transition
    enter-active-class="transition-all duration-150 ease-out"
    enter-from-class="opacity-0 scale-95"
    enter-to-class="opacity-100 scale-100"
    leave-active-class="transition-all duration-100 ease-in"
    leave-from-class="opacity-100 scale-100"
    leave-to-class="opacity-0 scale-95"
  >
    <div
      v-if="hoveredProject && isSidebarCollapsed"
      :style="{
        position: 'fixed',
        left: `${tooltipPosition.x}px`,
        top: `${tooltipPosition.y}px`,
        transform: 'translateY(-50%)',
        zIndex: 100
      }"
      class="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg shadow-xl pointer-events-none"
    >
      <div class="text-xs font-medium text-white whitespace-nowrap">
        {{ hoveredProject.name }}
      </div>
      <!-- Arrow pointing left -->
      <div 
        class="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800"
        style="margin-right: -1px;"
      ></div>
    </div>
  </Transition>
</template>
