import axios from 'axios';
import * as cheerio from 'cheerio';
import {McpLogger} from '../logger.js';
import {RepoSummary, SearchResult, TreeItem} from './types.js';

export class GitHubAPI {
    private logger: McpLogger;

    constructor(logger: McpLogger) {
        this.logger = logger.child('GitHubAPI');
    }

    /**
     * Extract owner and repo from URL
     */
    private parseRepoUrl(url: string): { owner: string; repo: string } {
        const repoPath = url.replace('https://github.com/', '').split('/tree/')[0];
        const [owner, repo] = repoPath.split('/');
        return {owner, repo};
    }

    /**
     * Fetch repository metadata from GitHub
     */
    public async fetchMetadata(url: string): Promise<{
        stars: number;
        forks: number;
        description: string;
        lastUpdated: string
    }> {
        try {
            const response = await axios.get(url);
            const $ = cheerio.load(response.data);

            const stars = parseInt($('[data-testid="stargazers"]').text().trim().replace(/,/g, '')) || 0;
            const forks = parseInt($('[data-testid="repo-stats-fork"]').text().trim().replace(/,/g, '')) || 0;
            const description = $('.my-3 p').text().trim();
            const lastUpdated = $('relative-time').attr('datetime') || '';

            return {stars, forks, description, lastUpdated};
        } catch (error) {
            this.logger.error('Error fetching metadata from GitHub:', error);
            throw new Error('Failed to fetch repository metadata');
        }
    }

    /**
     * Search repository via GitHub API
     */
    public async searchRepository(url: string, query: string, maxResults: number = 10): Promise<SearchResult[]> {
        const {owner, repo} = this.parseRepoUrl(url);

        try {
            // Use GitHub Search API
            const response = await axios.get(
                `https://api.github.com/search/code?q=${encodeURIComponent(query)}+repo:${owner}/${repo}`,
                {
                    headers: {
                        Accept: 'application/vnd.github.v3.text-match+json'
                    }
                }
            );

            const results: SearchResult[] = [];
            const items = response.data.items.slice(0, maxResults);

            for (const item of items) {
                // Fetch the file content to get context
                const fileResponse = await axios.get(item.url);
                const content = Buffer.from(fileResponse.data.content, 'base64').toString('utf-8');
                const lines = content.split('\n');

                // Find match in content
                const lineMatches = [];
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                        lineMatches.push({
                            line: i + 1,
                            content: lines[i]
                        });
                    }
                }

                // Add results
                for (const match of lineMatches.slice(0, 3)) { // Limit multiple matches in the same file
                    results.push({
                        path: item.path,
                        line: match.line,
                        content: match.content,
                        context: [], // GitHub API doesn't provide context lines
                        repository: `${owner}/${repo}`,
                        url: item.html_url
                    });

                    if (results.length >= maxResults) {
                        break;
                    }
                }

                if (results.length >= maxResults) {
                    break;
                }
            }

            return results;
        } catch (error) {
            this.logger.error('Error searching via GitHub API:', error);
            throw new Error(`Failed to search via GitHub API: ${(error as Error).message}`);
        }
    }

    /**
     * Get diff via GitHub API
     */
    public async getDiff(url: string, base: string, head: string): Promise<string> {
        const {owner, repo} = this.parseRepoUrl(url);

        try {
            // Use GitHub Compare API
            const response = await axios.get(
                `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`
            );

            const compareData = response.data;

            // Format the output
            let result = `Comparing ${base}...${head}\n\n`;
            result += `Status: ${compareData.status}\n`;
            result += `Ahead by: ${compareData.ahead_by} commit(s)\n`;
            result += `Behind by: ${compareData.behind_by} commit(s)\n\n`;

            if (compareData.total_commits === 0) {
                result += 'No commits found between these references\n';
            } else {
                result += `Total commits: ${compareData.total_commits}\n\n`;
                result += 'Commits:\n';

                for (const commit of compareData.commits) {
                    result += `${commit.sha.substring(0, 7)} - ${commit.commit.message.split('\n')[0]}\n`;
                    result += `Author: ${commit.commit.author.name} <${commit.commit.author.email}>\n`;
                    result += `Date: ${commit.commit.author.date}\n\n`;
                }

                result += 'Files changed:\n';
                for (const file of compareData.files) {
                    result += `${file.status}: ${file.filename} (${file.additions} additions, ${file.deletions} deletions)\n`;
                }
            }

            return result;
        } catch (error: any) {
            this.logger.error('Error getting diff via GitHub API:', error);
            throw new Error(`Failed to get diff via GitHub API: ${error.message}`);
        }
    }

    /**
     * Fetch repository data from GitHub API
     */
    public async fetchRepositoryData(url: string): Promise<{
        summary: RepoSummary;
        tree: string;
        content: string;
    }> {
        const {owner, repo} = this.parseRepoUrl(url);

        try {
            // Fetch repository info
            const repoInfo = await axios.get(`https://api.github.com/repos/${owner}/${repo}`);

            // Create summary
            const summaryStr = `Repository: ${owner}/${repo}\n` +
                `Files analyzed: ${repoInfo.data.size || 0}\n` +
                `Estimated tokens: Unknown\n` +
                `Description: ${repoInfo.data.description || 'No description'}`;

            const summary: RepoSummary = {
                repository: `${owner}/${repo}`,
                numFiles: repoInfo.data.size || 0,
                tokenCount: 'Unknown',
                raw: summaryStr,
                description: repoInfo.data.description,
                stars: repoInfo.data.stargazers_count,
                forks: repoInfo.data.forks_count,
                lastUpdated: repoInfo.data.updated_at
            };

            // Fetch tree structure
            let tree;
            try {
                const treeResponse = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`);
                tree = this.formatRepositoryTree(treeResponse.data.tree);
            } catch (error) {
                this.logger.warn('Error fetching repository tree:', error);
                tree = 'Error fetching repository tree structure';
            }

            // Fetch important files
            let content = '';
            try {
                const importantFiles = ['README.md', 'package.json', 'pyproject.toml', '.gitignore'];

                for (const file of importantFiles) {
                    try {
                        const response = await axios.get(
                            `https://api.github.com/repos/${owner}/${repo}/contents/${file}`
                        );

                        if (response.data.type === 'file') {
                            const fileContent = Buffer.from(response.data.content, 'base64').toString('utf-8');
                            content += `==================================================\n`;
                            content += `File: ${file}\n`;
                            content += `==================================================\n`;
                            content += fileContent + '\n\n';
                        }
                    } catch (error) {
                        // Skip files that don't exist or can't be read
                    }
                }

                if (!content) {
                    content = 'Unable to fetch file contents';
                }
            } catch (error) {
                this.logger.warn('Error fetching file contents:', error);
                content = 'Error fetching file contents';
            }

            return {summary, tree, content};
        } catch (error) {
            this.logger.error('Error fetching from GitHub API:', error);
            throw new Error(`Failed to fetch repository data: ${(error as Error).message}`);
        }
    }

    /**
     * Format repository tree from GitHub API response
     */
    private formatRepositoryTree(items: TreeItem[]): string {
        const buildTree = (items: TreeItem[], parentPath: string = '') => {
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

        return buildTree(items);
    }
}
