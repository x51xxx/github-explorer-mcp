import {McpLogger} from '../logger.js';

// Types for repository data
export interface RepoSummary {
    repository: string;
    numFiles: number | null;
    tokenCount: string;
    raw: string;
    description?: string;
    stars?: number;
    forks?: number;
    lastUpdated?: string;
}

export interface FileContent {
    path: string;
    content: string;
}

// Interface for search results
export interface SearchResult {
    path: string;          // Path to the file
    line: number;          // Line number where the match was found
    content: string;       // Content of the matched line
    context: string[];     // Surrounding context lines
    url?: string;          // URL to the file (when using GitHub API)
    repository?: string;   // Repository name (when using GitHub API)
}

// Options for GitIngester
export interface GitIngesterOptions {
    cacheDir?: string;
    cacheExpiry?: number; // in minutes
}

// Cache entry structure
export interface CacheEntry {
    summary: RepoSummary | null;
    tree: string | null;
    content: string | null;
    timestamp: number;
}

// Common context for all repository operations
export interface RepositoryContext {
    url: string;
    repoPath: string;
    logger: McpLogger;
}

export interface TreeItem {
    path: string;
    type: 'blob' | 'tree';
    mode?: string;
    sha?: string;
    size?: number;
    url?: string;
}
