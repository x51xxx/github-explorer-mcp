import {promises as fs} from 'fs';
import * as path from 'path';
import {McpLogger} from '../logger.js';
import {CacheEntry} from './types.js';

export class CacheManager {
    private cacheDir: string;
    private cacheExpiry: number; // in milliseconds
    private logger: McpLogger;

    constructor(cacheDir: string, cacheExpiryMinutes: number, logger: McpLogger) {
        this.cacheDir = cacheDir;
        this.cacheExpiry = cacheExpiryMinutes * 60 * 1000;
        this.logger = logger.child('CacheManager');
    }

    /**
     * Generate cache key from URL
     */
    public getCacheKey(url: string): string {
        return Buffer.from(url).toString('base64').replace(/[/+=]/g, '_');
    }

    /**
     * Load data from cache
     */
    public async loadFromCache(key: string): Promise<CacheEntry | null> {
        const cacheFile = path.join(this.cacheDir, `${key}.json`);

        try {
            const stat = await fs.stat(cacheFile);
            if (Date.now() - stat.mtimeMs > this.cacheExpiry) {
                return null; // Cache expired
            }

            const data = await fs.readFile(cacheFile, 'utf-8');
            return JSON.parse(data);
        } catch (_) {
            return null; // File doesn't exist or can't be read
        }
    }

    /**
     * Save data to cache
     */
    public async saveToCache(key: string, data: CacheEntry): Promise<void> {
        try {
            await fs.mkdir(this.cacheDir, {recursive: true});
            const cacheFile = path.join(this.cacheDir, `${key}.json`);
            await fs.writeFile(cacheFile, JSON.stringify(data), 'utf-8');
        } catch (error) {
            this.logger.error('Error saving to cache:', error);
        }
    }
}
