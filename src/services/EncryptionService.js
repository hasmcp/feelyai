import bcrypt from 'bcryptjs';

/**
 * EncryptionService - Handles password hashing and content encryption/decryption
 * Uses bcrypt for password hashing and Web Crypto API (AES-GCM) for content encryption
 */
class EncryptionService {
    constructor() {
        this.SALT_ROUNDS = 10;
        this.KEY_ITERATIONS = 100000;
    }

    /**
     * Hash a password using bcrypt
     * @param {string} password - Plain text password
     * @returns {Promise<string>} - Bcrypt hash
     */
    async hashPassword(password) {
        return bcrypt.hash(password, this.SALT_ROUNDS);
    }

    /**
     * Verify a password against a bcrypt hash
     * @param {string} password - Plain text password
     * @param {string} hash - Bcrypt hash
     * @returns {Promise<boolean>} - True if password matches
     */
    async verifyPassword(password, hash) {
        return bcrypt.compare(password, hash);
    }

    /**
     * Generate a random salt for key derivation
     * @returns {string} - Base64 encoded salt
     */
    generateSalt() {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        return this._arrayBufferToBase64(salt);
    }

    /**
     * Derive an AES-GCM key from password using PBKDF2
     * @param {string} password - User password
     * @param {string} saltBase64 - Base64 encoded salt
     * @returns {Promise<CryptoKey>} - AES-GCM key
     */
    async deriveKey(password, saltBase64) {
        const enc = new TextEncoder();
        const passwordBuffer = enc.encode(password);
        const salt = this._base64ToArrayBuffer(saltBase64);

        // Import password as key material
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );

        // Derive AES-GCM key
        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: this.KEY_ITERATIONS,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Encrypt data using AES-GCM
     * @param {any} data - Data to encrypt (will be JSON stringified)
     * @param {CryptoKey} key - AES-GCM key
     * @returns {Promise<{encrypted: string, iv: string}>} - Encrypted data and IV
     */
    async encrypt(data, key) {
        const enc = new TextEncoder();
        const plaintext = enc.encode(JSON.stringify(data));

        // Generate random IV
        const iv = crypto.getRandomValues(new Uint8Array(12));

        // Encrypt
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            plaintext
        );

        return {
            encrypted: this._arrayBufferToBase64(encrypted),
            iv: this._arrayBufferToBase64(iv)
        };
    }

    /**
     * Decrypt data using AES-GCM
     * @param {string} encryptedBase64 - Base64 encoded encrypted data
     * @param {CryptoKey} key - AES-GCM key
     * @param {string} ivBase64 - Base64 encoded IV
     * @returns {Promise<any>} - Decrypted data (parsed from JSON)
     */
    async decrypt(encryptedBase64, key, ivBase64) {
        const encrypted = this._base64ToArrayBuffer(encryptedBase64);
        const iv = this._base64ToArrayBuffer(ivBase64);

        try {
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                encrypted
            );

            const dec = new TextDecoder();
            const plaintext = dec.decode(decrypted);
            return JSON.parse(plaintext);
        } catch (error) {
            throw new Error('Decryption failed - invalid password or corrupted data');
        }
    }

    /**
     * Encrypt entire project data
     * @param {object} projectData - { chats, messages, systemPrompt }
     * @param {string} password - User password
     * @returns {Promise<object>} - Encrypted project data with metadata
     */
    async encryptProject(projectData, password) {
        const salt = this.generateSalt();
        const key = await this.deriveKey(password, salt);

        const { encrypted: encryptedChats, iv: chatsIv } = await this.encrypt(
            projectData.chats || [],
            key
        );

        const { encrypted: encryptedMessages, iv: messagesIv } = await this.encrypt(
            projectData.messages || [],
            key
        );

        const { encrypted: encryptedSystemPrompt, iv: systemPromptIv } = await this.encrypt(
            projectData.systemPrompt || null,
            key
        );

        return {
            salt,
            encryptedChats,
            chatsIv,
            encryptedMessages,
            messagesIv,
            encryptedSystemPrompt,
            systemPromptIv
        };
    }

    /**
     * Decrypt entire project data
     * @param {object} encryptedData - Encrypted project data
     * @param {string} password - User password
     * @returns {Promise<object>} - Decrypted project data
     */
    async decryptProject(encryptedData, password) {
        const key = await this.deriveKey(password, encryptedData.salt);

        const chats = await this.decrypt(
            encryptedData.encryptedChats,
            key,
            encryptedData.chatsIv
        );

        const messages = await this.decrypt(
            encryptedData.encryptedMessages,
            key,
            encryptedData.messagesIv
        );

        const systemPrompt = await this.decrypt(
            encryptedData.encryptedSystemPrompt,
            key,
            encryptedData.systemPromptIv
        );

        return {
            chats,
            messages,
            systemPrompt
        };
    }

    // Helper methods for base64 encoding/decoding
    _arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    _base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }
}

export default new EncryptionService();
