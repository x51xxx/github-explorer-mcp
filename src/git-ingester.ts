import {promises as fs} from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as crypto from 'crypto';
import {simpleGit as simpleGitFn} from 'simple-git';
import * as os from 'os';
import {rm} from 'fs/promises';
// Import logger
import {logger, McpLogger} from './logger.js';

// Types for repository data
interface RepoSummary {
    repository: string;
    numFiles: number | null;
    tokenCount: string;
    raw: string;
    description?: string;
    stars?: number;
    forks?: number;
    lastUpdated?: string;
}

interface FileContent {
    path: string;
    content: string;
}

// Main GitIngester class
export class GitIngester {
    private url: string;
    private summary: RepoSummary | null = null;
    private tree: string | null = null;
    private content: string | null = null;
    private cacheDir: string;
    private cacheExpiry: number; // in minutes
    private logger: McpLogger;

    constructor(
        url: string,
        branch?: string,
        options?: {
            cacheDir?: string,
            cacheExpiry?: number
        }
    ) {
        this.url = url;
        if (branch) {
            this.url = `${url}/tree/${branch}`;
        }
        this.cacheDir = options?.cacheDir || path.join(process.cwd(), '.github-explorer-cache');
        this.cacheExpiry = (options?.cacheExpiry || 60) * 60 * 1000; // Convert minutes to milliseconds
        this.logger = logger.child('GitIngester');
    }

    /**
     * Clone repository locally
     */
    private async cloneRepository(): Promise<string> {
        // Create a deterministic directory name based on repo URL
        const repoHash = crypto
            .createHash('sha256')
            .update(this.url)
            .digest('hex')
            .substring(0, 12);

        const tempDir = path.join(os.tmpdir(), `git_explorer_${repoHash}`);

        // If directory exists and is a valid git repo, return it
        if (await fs.stat(tempDir).catch(() => false)) {
            try {
                const git = simpleGitFn(tempDir);
                const remotes = await git.getRemotes(true);
                const remoteUrl = remotes.find((r: any) => r.name === 'origin')?.refs.fetch;

                if (remoteUrl && this.normalizeUrl(remoteUrl) === this.normalizeUrl(this.extractBaseUrl())) {
                    this.logger.debug(`Reusing existing repository at ${tempDir}`);
                    return tempDir;
                }
            } catch (error: any) {
                this.logger.warn('Error checking existing repository:', error);
                // If there's any error with existing repo, clean it up
                await rm(tempDir, {recursive: true, force: true});
            }
        }

        // Create directory and clone repository
        await fs.mkdir(tempDir, {recursive: true});
        try {
            this.logger.debug(`Cloning repository ${this.url} to ${tempDir}`);
            const git = simpleGitFn();
            await git.clone(this.extractBaseUrl(), tempDir);

            // Checkout specific branch if provided
            if (this.url.includes('/tree/')) {
                const branch = this.url.split('/tree/')[1];
                const localGit = simpleGitFn(tempDir);
                await localGit.checkout(branch);
            }

            return tempDir;
        } catch (error: any) {
            // Clean up on error
            await rm(tempDir, {recursive: true, force: true});
            throw new Error(`Failed to clone repository: ${error.message}`);
        }
    }

    /**
     * Generate a tree-like directory structure string
     */
    private async generateDirectoryTree(path: string, prefix: string = ""): Promise<string> {
        let output = "";
        const entries = await fs.readdir(path);
        entries.sort();

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (entry.startsWith('.git')) {
                continue;
            }

            const isLast = i === entries.length - 1;
            const currentPrefix = isLast ? "└── " : "├── ";
            const nextPrefix = isLast ? "    " : "│   ";

            const entryPath = `${path}/${entry}`;
            const stats = await fs.stat(entryPath);

            output += prefix + currentPrefix + entry + "\n";

            if (stats.isDirectory()) {
                output += await this.generateDirectoryTree(entryPath, prefix + nextPrefix);
            }
        }

        return output;
    }

    /**
     * Fetch repository data with caching support
     */
    public async fetchRepoData(): Promise<void> {
        const cacheKey = this.getCacheKey();

        try {
            // Try to load from cache first
            const cachedData = await this.loadFromCache(cacheKey);
            if (cachedData) {
                this.summary = cachedData.summary;
                this.tree = cachedData.tree;
                this.content = cachedData.content;
                return;
            }
        } catch (error) {
            this.logger.warn('Cache read error:', error);
        }

        // Try to clone repository and extract data
        try {
            const repoPath = await this.cloneRepository();

            // Generate tree structure
            this.tree = await this.generateDirectoryTree(repoPath);

            // Count files and build summary
            let fileCount = 0;
            let tokenCount = "Unknown";

            // Walk through the repository and count files
            const countFiles = async (dir: string): Promise<number> => {
                let count = 0;
                const entries = await fs.readdir(dir);

                for (const entry of entries) {
                    if (entry.startsWith('.git')) continue;

                    const fullPath = path.join(dir, entry);
                    const stats = await fs.stat(fullPath);

                    if (stats.isDirectory()) {
                        count += await countFiles(fullPath);
                    } else {
                        count++;
                    }
                }

                return count;
            };

            fileCount = await countFiles(repoPath);

            // Extract repository name
            const baseUrl = this.extractBaseUrl();
            const repoName = baseUrl.replace('https://github.com/', '');

            // Build summary
            this.summary = this.parseSummary(
                `Repository: ${repoName}\n` +
                `Files analyzed: ${fileCount}\n` +
                `Estimated tokens: ${tokenCount}`
            );

            // Read repository content
            this.content = await this.readRepositoryContent(repoPath);

            // Fetch additional metadata if needed
            try {
                const metadata = await this.fetchMetadata();
                this.summary.description = metadata.description;
                this.summary.stars = metadata.stars;
                this.summary.forks = metadata.forks;
                this.summary.lastUpdated = metadata.lastUpdated;
            } catch (error) {
                this.logger.warn('Error fetching metadata:', error);
            }

            // Save to cache
            await this.saveToCache(cacheKey, {
                summary: this.summary,
                tree: this.tree,
                content: this.content,
                timestamp: Date.now(),
            });

        } catch (error: any) {
            this.logger.error('Error processing repository:', error);
            // Fallback to remote API if local clone fails
            await this.fetchFromRemote();

            // Save to cache
            try {
                await this.saveToCache(cacheKey, {
                    summary: this.summary,
                    tree: this.tree,
                    content: this.content,
                    timestamp: Date.now(),
                });
            } catch (error) {
                this.logger.warn('Cache write error:', error);
            }
        }
    }

    /**
     * Fetch additional metadata from GitHub
     */
    public async fetchMetadata(): Promise<{ stars: number; forks: number; description: string; lastUpdated: string }> {
        const baseUrl = this.extractBaseUrl();
        const response = await axios.get(baseUrl);
        const $ = cheerio.load(response.data);

        const stars = parseInt($('[data-testid="stargazers"]').text().trim().replace(/,/g, '')) || 0;
        const forks = parseInt($('[data-testid="repo-stats-fork"]').text().trim().replace(/,/g, '')) || 0;
        const description = $('.my-3 p').text().trim();
        const lastUpdated = $('relative-time').attr('datetime') || '';

        // Update summary with additional metadata
        if (this.summary) {
            this.summary = {
                ...this.summary,
                stars,
                forks,
                description,
                lastUpdated
            };
        }

        return {stars, forks, description, lastUpdated};
    }

    /**
     * Get repository summary
     */
    public getSummary(): string | null {
        return this.summary?.raw || null;
    }

    /**
     * Get summary as structured object
     */
    public getSummaryObject(): RepoSummary | null {
        return this.summary;
    }

    /**
     * Get repository tree structure
     */
    public getTree(): string | null {
        return this.tree;
    }

    /**
     * Get all repository content
     */
    public getContent(): string | null {
        return this.content;
    }

    /**
     * Get content of specific files
     */
    public getFilesContent(filePaths: string[]): string {
        if (!this.content) {
            return "";
        }

        const result: Record<string, string | null> = {};
        filePaths.forEach(path => {
            result[path] = null;
        });

        const contentStr = this.content.toString();

        // Different patterns to match file sections
        const patterns = [
            /={50}\nFile: ([^\n]+)\n={50}/g,
            /={10,}\nFile: ([^\n]+)\n={10,}/g,
            /=+\s*File:\s*([^\n]+)\s*\n=+/g
        ];

        for (const pattern of patterns) {
            let match: RegExpExecArray | null;
            let matched = false;
            pattern.lastIndex = 0;

            while ((match = pattern.exec(contentStr)) !== null) {
                matched = true;
                const startPos = match.index + match[0].length;
                const filename = match[1].trim();

                // Reset the pattern to find the next match
                pattern.lastIndex = startPos;
                const nextMatch = pattern.exec(contentStr);
                pattern.lastIndex = startPos;

                const endPos = nextMatch ? nextMatch.index : contentStr.length;
                const fileContent = contentStr.substring(startPos, endPos).trim();

                // Check if this file matches any requested path
                for (const path of filePaths) {
                    const basename = path.split('/').pop() || '';
                    if (path === filename || basename === filename || path.endsWith('/' + filename)) {
                        result[path] = fileContent;
                    }
                }
            }

            if (matched) break;
        }

        // Build concatenated result
        let concatenated = '';
        Object.entries(result).forEach(([path, content]) => {
            if (content !== null) {
                if (concatenated) concatenated += '\n\n';
                concatenated += `==================================================\nFile: ${path}\n==================================================\n${content}`;
            }
        });

        return concatenated;
    }

    /**
     * Get specific files as structured objects
     */
    public getFilesAsObjects(filePaths: string[]): FileContent[] {
        const fileContentsStr = this.getFilesContent(filePaths);
        const fileContents: FileContent[] = [];

        if (!fileContentsStr) return fileContents;

        // Use regex to split the concatenated content into file objects
        const fileRegex = /={50,}\nFile: ([^\n]+)\n={50,}\n([\s\S]*?)(?=\n={50,}\nFile:|$)/g;
        let match;

        while ((match = fileRegex.exec(fileContentsStr)) !== null) {
            fileContents.push({
                path: match[1],
                content: match[2].trim()
            });
        }

        return fileContents;
    }

    /**
     * Parse summary string into structured object
     */
    private parseSummary(summaryStr: string): RepoSummary {
        const summaryDict: RepoSummary = {
            repository: '',
            numFiles: null,
            tokenCount: '',
            raw: summaryStr
        };

        try {
            // Extract repository name
            const repoMatch = summaryStr.match(/Repository: (.+)/);
            if (repoMatch) {
                summaryDict.repository = repoMatch[1].trim();
            }

            // Extract files analyzed
            const filesMatch = summaryStr.match(/Files analyzed: (\d+)/);
            if (filesMatch) {
                summaryDict.numFiles = parseInt(filesMatch[1]);
            }

            // Extract estimated tokens
            const tokensMatch = summaryStr.match(/Estimated tokens: (.+)/);
            if (tokensMatch) {
                summaryDict.tokenCount = tokensMatch[1].trim();
            }
        } catch (error) {
            this.logger.error('Error parsing summary:', error);
        }

        return summaryDict;
    }

    /**
     * Generate cache key from URL
     */
    private getCacheKey(): string {
        return Buffer.from(this.url).toString('base64').replace(/[/+=]/g, '_');
    }

    /**
     * Load data from cache
     */
    private async loadFromCache(key: string): Promise<any | null> {
        const cacheFile = path.join(this.cacheDir, `${key}.json`);

        try {
            const stat = await fs.stat(cacheFile);
            if (Date.now() - stat.mtimeMs > this.cacheExpiry) {
                return null; // Cache expired
            }

            const data = await fs.readFile(cacheFile, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            return null; // File doesn't exist or can't be read
        }
    }

    /**
     * Save data to cache
     */
    private async saveToCache(key: string, data: any): Promise<void> {
        try {
            await fs.mkdir(this.cacheDir, {recursive: true});
            const cacheFile = path.join(this.cacheDir, `${key}.json`);
            await fs.writeFile(cacheFile, JSON.stringify(data), 'utf-8');
        } catch (error) {
            this.logger.error('Error saving to cache:', error);
        }
    }

    /**
     * Normalize Git URL to handle different formats
     */
    private normalizeUrl(url: string): string {
        return url.replace(/\.git$/, '').replace(/\/$/, '');
    }

    /**
     * Extract base URL (for metadata fetching)
     */
    private extractBaseUrl(): string {
        return this.url.replace(/\/tree\/.*$/, '');
    }

    /**
     * Read repository content from local clone
     */
    private async readRepositoryContent(repoPath: string): Promise<string> {
        let content = '';

        const processFile = async (filePath: string, relativePath: string) => {
            try {
                const fileContent = await fs.readFile(filePath, 'utf-8');
                content += `==================================================\n`;
                content += `File: ${relativePath}\n`;
                content += `==================================================\n`;
                content += fileContent + '\n\n';
            } catch (error) {
                this.logger.warn(`Error reading file ${filePath}:`, error);
            }
        };

        const processDirectory = async (dirPath: string, relativePath: string = '') => {
            const entries = await fs.readdir(dirPath);

            for (const entry of entries) {
                if (entry.startsWith('.git')) continue;

                const fullPath = path.join(dirPath, entry);
                const entryRelativePath = relativePath ? path.join(relativePath, entry) : entry;
                const stats = await fs.stat(fullPath);

                if (stats.isDirectory()) {
                    await processDirectory(fullPath, entryRelativePath);
                } else {
                    // Skip binary files and very large files
                    if (stats.size > 1024 * 1024) {
                        content += `==================================================\n`;
                        content += `File: ${entryRelativePath}\n`;
                        content += `==================================================\n`;
                        content += `[File too large to display: ${(stats.size / 1024 / 1024).toFixed(2)} MB]\n\n`;
                    } else {
                        await processFile(fullPath, entryRelativePath);
                    }
                }
            }
        };

        await processDirectory(repoPath);
        return content;
    }

    /**
     * Fetch repository data from remote GitHub API
     * This is a fallback when local cloning fails
     */
    private async fetchFromRemote(): Promise<void> {
        try {
            // Get repo data
            const repoName = this.url.replace('https://github.com/', '').split('/tree/')[0];
            const [owner, repo] = repoName.split('/');

            // Fetch repository info (would typically use GitHub API)
            const repoInfo = await axios.get(`https://api.github.com/repos/${owner}/${repo}`);

            // Create summary
            this.summary = this.parseSummary(
                `Repository: ${repoName}\n` +
                `Files analyzed: ${repoInfo.data.size || 0}\n` +
                `Estimated tokens: Unknown\n` +
                `Description: ${repoInfo.data.description || 'No description'}`
            );

            // Add additional metadata
            this.summary.stars = repoInfo.data.stargazers_count;
            this.summary.forks = repoInfo.data.forks_count;
            this.summary.description = repoInfo.data.description;
            this.summary.lastUpdated = repoInfo.data.updated_at;

            // Fetch repository tree structure
            try {
                const treeResponse = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`);
                let treeOutput = '';

                // Create a basic tree structure
                const buildTree = (items: any[], parentPath: string = '') => {
                    const dirs: Record<string, any[]> = {};
                    const files: string[] = [];

                    // Group items by directory
                    for (const item of items) {
                        const path = item.path;
                        if (!path.startsWith(parentPath)) continue;

                        const relativePath = path.slice(parentPath.length);
                        const parts = relativePath.split('/');

                        if (parts.length === 1 && relativePath) {
                            if (item.type === 'blob') {
                                files.push(relativePath);
                            } else if (item.type === 'tree') {
                                dirs[relativePath] = [];
                            }
                        } else if (parts.length > 1 && relativePath) {
                            const dir = parts[0];
                            if (!dirs[dir]) dirs[dir] = [];
                        }
                    }

                    // Sort directories and files
                    const sortedDirs = Object.keys(dirs).sort();
                    files.sort();

                    let output = '';
                    [...sortedDirs, ...files].forEach((entry, i, arr) => {
                        const isLast = i === arr.length - 1;
                        const prefix = isLast ? '└── ' : '├── ';
                        const childPrefix = isLast ? '    ' : '│   ';

                        output += prefix + entry + '\n';

                        if (sortedDirs.includes(entry)) {
                            const childOutput = buildTree(
                                items,
                                parentPath + entry + '/'
                            );

                            if (childOutput) {
                                output += childOutput.split('\n').map(line => childPrefix + line).join('\n') + '\n';
                            }
                        }
                    });

                    return output.trimEnd();
                };

                this.tree = buildTree(treeResponse.data.tree);
            } catch (error) {
                this.logger.warn('Error fetching repository tree:', error);
                this.tree = 'Error fetching repository tree structure';
            }

            // Fetch file contents for key files
            try {
                const importantFiles = ['README.md', 'package.json', 'pyproject.toml', '.gitignore'];
                this.content = '';

                for (const file of importantFiles) {
                    try {
                        const response = await axios.get(
                            `https://api.github.com/repos/${owner}/${repo}/contents/${file}`
                        );

                        if (response.data.type === 'file') {
                            const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
                            this.content += `==================================================\n`;
                            this.content += `File: ${file}\n`;
                            this.content += `==================================================\n`;
                            this.content += content + '\n\n';
                        }
                    } catch (error) {
                        this.logger.warn(`Error fetching ${file}:`, error);
                    }
                }

                if (!this.content) {
                    this.content = 'Unable to fetch file contents';
                }
            } catch (error) {
                this.logger.warn('Error fetching file contents:', error);
                this.content = 'Error fetching file contents';
            }
        } catch (error: any) {
            this.logger.error('Error fetching from remote:', error);
            throw new Error(`Failed to fetch repository data: ${error.message}`);
        }
    }
}
