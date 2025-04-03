import * as path from 'path';
import {logger} from '../logger.js';
import {RepositoryCloner} from './repository-cloner.js';
import {RepositoryAnalyzer} from './repository-analyzer.js';
import {RepositorySearcher} from './repository-searcher.js';
import {RepositoryDiffer} from './repository-differ.js';
import {CacheManager} from './cache-manager.js';
import {GitHubAPI} from './github-api.js';
import {FileContent, GitIngesterOptions, RepositoryContext, RepoSummary, SearchResult} from './types.js';

// Main GitIngester class
export class GitIngester {
    private url: string;
    private summary: RepoSummary | null = null;
    private tree: string | null = null;
    private content: string | null = null;

    private cloner: RepositoryCloner;
    private analyzer: RepositoryAnalyzer | null = null;
    private searcher: RepositorySearcher | null = null;
    private differ: RepositoryDiffer | null = null;
    private cacheManager: CacheManager;
    private githubAPI: GitHubAPI;

    private repoPath: string | null = null;
    private initialBranch: string | null = null;

    constructor(
        url: string,
        branch?: string,
        options?: GitIngesterOptions
    ) {
        this.url = url;
        if (branch) {
            this.url = `${url}/tree/${branch}`;
            this.initialBranch = branch;
        }

        // Initialize components
        const mcpLogger = logger.child('GitIngester');
        this.cloner = new RepositoryCloner(mcpLogger);
        this.cacheManager = new CacheManager(
            options?.cacheDir || path.join(process.cwd(), '.github-explorer-cache'),
            options?.cacheExpiry || 60,
            mcpLogger
        );
        this.githubAPI = new GitHubAPI(mcpLogger);
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
     * Fetch repository data with caching support
     */
    public async fetchRepoData(): Promise<void> {
        const cacheKey = this.cacheManager.getCacheKey(this.url);

        try {
            // Try to load from cache first
            const cachedData = await this.cacheManager.loadFromCache(cacheKey);
            if (cachedData) {
                this.summary = cachedData.summary;
                this.tree = cachedData.tree;
                this.content = cachedData.content;
                return;
            }
        } catch (error) {
            logger.warn('Cache read error:', error);
        }

        // Try to clone repository and extract data
        try {
            this.repoPath = await this.cloner.cloneRepository(this.url);

            // Create repository context for analyzer and other components
            const context: RepositoryContext = {
                url: this.url,
                repoPath: this.repoPath,
                logger: logger
            };

            // Initialize components that need repository path
            this.analyzer = new RepositoryAnalyzer(context);
            this.searcher = new RepositorySearcher(context);
            this.differ = new RepositoryDiffer(context);

            // Generate tree structure
            this.tree = await this.analyzer.generateDirectoryTree(this.repoPath);

            // Count files
            const fileCount = await this.analyzer.countFiles(this.repoPath);

            // Extract repository name
            const baseUrl = this.cloner.extractBaseUrl(this.url);
            const repoName = this.analyzer.extractRepoName(baseUrl);

            // Build summary
            this.summary = this.analyzer.parseSummary(
                `Repository: ${repoName}\n` +
                `Files analyzed: ${fileCount}\n` +
                `Estimated tokens: Unknown`
            );

            // Read repository content
            this.content = await this.analyzer.readRepositoryContent(this.repoPath);

            // Fetch additional metadata if needed
            try {
                const metadata = await this.githubAPI.fetchMetadata(baseUrl);
                this.summary = {
                    ...this.summary,
                    stars: metadata.stars,
                    forks: metadata.forks,
                    description: metadata.description,
                    lastUpdated: metadata.lastUpdated
                };
            } catch (error) {
                logger.warn('Error fetching metadata:', error);
            }

            // Save to cache
            await this.cacheManager.saveToCache(cacheKey, {
                summary: this.summary,
                tree: this.tree,
                content: this.content,
                timestamp: Date.now(),
            });

        } catch (error) {
            logger.error('Error processing repository:', error);
            // Fallback to remote API if local clone fails
            await this.fetchFromRemote();

            // Save to cache
            try {
                await this.cacheManager.saveToCache(cacheKey, {
                    summary: this.summary,
                    tree: this.tree,
                    content: this.content,
                    timestamp: Date.now(),
                });
            } catch (error) {
                logger.warn('Cache write error:', error);
            }
        }
    }

    /**
     * Fetch repository data from remote GitHub API as fallback
     */
    private async fetchFromRemote(): Promise<void> {
        try {
            const baseUrl = this.cloner.extractBaseUrl(this.url);
            const {summary, tree, content} = await this.githubAPI.fetchRepositoryData(baseUrl);

            this.summary = summary;
            this.tree = tree;
            this.content = content;
        } catch (error) {
            logger.error('Error fetching from remote:', error);
            throw new Error(`Failed to fetch repository data: ${(error as Error).message}`);
        }
    }

    /**
     * Get content of specific files from repository content
     */
    public getFilesContent(filePaths: string[]): string {
        if (!this.content || !this.analyzer) {
            return "";
        }
        return this.analyzer.extractFilesContent(this.content, filePaths);
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
     * Search repository content for a query string
     */
    public async searchRepositoryContent(query: string, maxResults: number = 10): Promise<SearchResult[]> {
        if (!this.searcher) {
            if (!this.repoPath) {
                // Try to fetch repository first if not already done
                await this.fetchRepoData();

                if (!this.repoPath) {
                    // If still no repository path, use the GitHub API
                    return this.searchViaGitHubAPI(query, maxResults);
                }
            }

            // Initialize searcher if it's still null
            if (!this.searcher && this.repoPath) {
                const context: RepositoryContext = {
                    url: this.url,
                    repoPath: this.repoPath,
                    logger: logger
                };
                this.searcher = new RepositorySearcher(context);
            }
        }

        try {
            // Now searcher should be initialized
            if (this.searcher) {
                return await this.searcher.searchContent(query, maxResults);
            } else {
                // Fallback to GitHub API if searcher is still null
                logger.warn('Searcher not initialized, falling back to GitHub API');
                return this.searchViaGitHubAPI(query, maxResults);
            }
        } catch (error) {
            logger.warn('Local search failed, falling back to GitHub API:', error);
            return this.searchViaGitHubAPI(query, maxResults);
        }
    }

    /**
     * Search repository via GitHub API as a fallback
     */
    public async searchViaGitHubAPI(query: string, maxResults: number = 10): Promise<SearchResult[]> {
        const baseUrl = this.cloner.extractBaseUrl(this.url);
        return this.githubAPI.searchRepository(baseUrl, query, maxResults);
    }

    /**
     * Get diff between two branches or commits
     */
    public async getDiff(base: string, head: string): Promise<string> {
        if (!this.differ) {
            if (!this.repoPath) {
                // Try to fetch repository first if not already done
                await this.fetchRepoData();

                if (!this.repoPath) {
                    // If still no repository path, use the GitHub API
                    return this.getDiffViaGitHubAPI(base, head);
                }
            }

            // Initialize differ if it's still null
            if (!this.differ && this.repoPath) {
                const context: RepositoryContext = {
                    url: this.url,
                    repoPath: this.repoPath,
                    logger: logger
                };
                this.differ = new RepositoryDiffer(context);
            }
        }

        try {
            // Now differ should be initialized
            if (this.differ) {
                return await this.differ.getDiff(base, head);
            } else {
                // Fallback to GitHub API if differ is still null
                logger.warn('Differ not initialized, falling back to GitHub API');
                return this.getDiffViaGitHubAPI(base, head);
            }
        } catch (error) {
            logger.warn('Local diff failed, falling back to GitHub API:', error);
            return this.getDiffViaGitHubAPI(base, head);
        }
    }

    /**
     * Get diff via GitHub API as a fallback
     */
    public async getDiffViaGitHubAPI(base: string, head: string): Promise<string> {
        const baseUrl = this.cloner.extractBaseUrl(this.url);
        return this.githubAPI.getDiff(baseUrl, base, head);
    }

    /**
     * Fetch additional metadata from GitHub
     */
    public async fetchMetadata(): Promise<{ stars: number; forks: number; description: string; lastUpdated: string }> {
        const baseUrl = this.cloner.extractBaseUrl(this.url);
        const metadata = await this.githubAPI.fetchMetadata(baseUrl);

        // Update summary with metadata
        if (this.summary) {
            this.summary = {
                ...this.summary,
                stars: metadata.stars,
                forks: metadata.forks,
                description: metadata.description,
                lastUpdated: metadata.lastUpdated
            };
        }

        return metadata;
    }
}
