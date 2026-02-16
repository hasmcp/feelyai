import { openDB } from 'idb';

const DB_NAME = 'webllm_chat_db';
const STORE_NAME = 'messages';
const PROJECT_STORE = 'projects';
const CHAT_STORE = 'chats';
const VERSION = 2; // Incremented

export class MessageStore {
    constructor() {
        this._initDb();
    }

    _initDb() {
        this.dbPromise = openDB(DB_NAME, VERSION, {
            upgrade(db, oldVersion, newVersion, transaction) {
                // Version 1: Messages Store
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp');
                }

                // Version 2: Projects & Chats
                if (oldVersion < 2) {
                    // Projects Store
                    if (!db.objectStoreNames.contains(PROJECT_STORE)) {
                        const projectStore = db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
                        projectStore.createIndex('createdAt', 'createdAt');
                    }

                    // Chats Store
                    if (!db.objectStoreNames.contains(CHAT_STORE)) {
                        const chatStore = db.createObjectStore(CHAT_STORE, { keyPath: 'id' });
                        chatStore.createIndex('projectId', 'projectId');
                        chatStore.createIndex('updatedAt', 'updatedAt');
                    }

                    // Add chatId index to existing messages store
                    const messageStore = transaction.objectStore(STORE_NAME);
                    if (!messageStore.indexNames.contains('chatId')) {
                        messageStore.createIndex('chatId', 'chatId');
                    }
                }
            },
            terminated() {
                // Handle unexpected termination
                console.warn('IDB terminated unexpectedly');
            }
        });
    }

    async _run(callback) {
        try {
            const db = await this.dbPromise;
            return await callback(db);
        } catch (error) {
            // Check for various closure/connection errors
            if (error.name === 'InvalidStateError' ||
                error.message?.includes('closing') ||
                error.message?.includes('closed')) {
                console.warn('Database connection closed or invalid, reopening...', error);
                this._initDb();
                const db = await this.dbPromise;
                return await callback(db);
            }
            throw error;
        }
    }

    // --- Projects ---
    async createProject(name, systemPrompt = null) {
        return this._run(async (db) => {
            const project = {
                id: crypto.randomUUID(),
                name,
                systemPrompt: systemPrompt || null,
                createdAt: Date.now()
            };
            await db.put(PROJECT_STORE, project);
            return project;
        });
    }

    async updateProject(project) {
        return this._run(async (db) => {
            await db.put(PROJECT_STORE, project);
        });
    }

    async getProjects() {
        return this._run(async (db) => {
            return await db.getAllFromIndex(PROJECT_STORE, 'createdAt');
        });
    }

    async deleteProject(id) {
        return this._run(async (db) => {
            const chats = await this.getChats(id); // Using public method (recursive _run is fine as promises wait)
            // Actually getChats calls _run, which awaits dbPromise.
            // If we are inside _run, we are occupying the 'thread' but db operations are async.
            // However, getChats will try to get dbPromise again. 
            // Since we don't lock, it's fine.

            const tx = db.transaction([PROJECT_STORE, CHAT_STORE, STORE_NAME], 'readwrite');
            const projectStore = tx.objectStore(PROJECT_STORE);
            const chatStore = tx.objectStore(CHAT_STORE);
            const messageStore = tx.objectStore(STORE_NAME);

            // Delete Project
            await projectStore.delete(id);

            // Delete Chats and their Messages
            for (const chat of chats) {
                const messages = await messageStore.index('chatId').getAllKeys(chat.id);
                for (const msgId of messages) {
                    await messageStore.delete(msgId);
                }
                await chatStore.delete(chat.id);
            }

            await tx.done;
        });
    }

    // --- Chats ---
    async createChat(projectId, title = "New Chat") {
        return this._run(async (db) => {
            const chat = {
                id: crypto.randomUUID(),
                projectId,
                title,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            await db.put(CHAT_STORE, chat);
            return chat;
        });
    }

    async updateChat(chat) {
        return this._run(async (db) => {
            chat.updatedAt = Date.now();
            await db.put(CHAT_STORE, chat);
        });
    }

    async getChats(projectId) {
        return this._run(async (db) => {
            const allChats = await db.getAllFromIndex(CHAT_STORE, 'updatedAt');
            return allChats.filter(c => c.projectId === projectId).reverse();
        });
    }

    async deleteChat(chatId) {
        return this._run(async (db) => {
            await db.delete(CHAT_STORE, chatId);
        });
    }

    // --- Messages ---
    async addMessage(message) {
        return this._run(async (db) => {
            // Ensure message has an ID and timestamp
            if (!message.id) message.id = crypto.randomUUID();
            if (!message.timestamp) message.timestamp = Date.now();

            await db.put(STORE_NAME, message);
            return message;
        });
    }

    async updateMessage(message) {
        return this._run(async (db) => {
            await db.put(STORE_NAME, message);
        });
    }

    async getMessages(chatId, limit = 50) {
        return this._run(async (db) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const index = tx.store.index('chatId');
            const messages = await index.getAll(chatId);
            messages.sort((a, b) => a.timestamp - b.timestamp);

            if (limit && messages.length > limit) {
                return messages.slice(messages.length - limit);
            }
            return messages;
        });
    }

    // Legacy support for global get (optional, maybe remove?)
    async getRecentMessages(limit = 20) {
        return this._run(async (db) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const index = tx.store.index('timestamp');
            let cursor = await index.openCursor(null, 'prev');
            const messages = [];
            while (cursor && messages.length < limit) {
                messages.unshift(cursor.value);
                cursor = await cursor.continue();
            }
            return messages;
        });
    }

    async clearMessages() {
        return this._run(async (db) => {
            await db.clear(STORE_NAME);
        });
    }
}

export const messageStore = new MessageStore();
