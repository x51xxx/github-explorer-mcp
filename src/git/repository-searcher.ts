import {promises as fs} from 'fs';
import * as path from 'path';
import {RepositoryContext, SearchResult} from './types.js';

export class RepositorySearcher {
    private context: RepositoryContext;

    constructor(context: RepositoryContext) {
        this.context = context;
    }

    /**
     * Search repository content for a query string
     * @param query The search query
     * @param maxResults Maximum number of results to return
     * @returns Array of search results with file path, line number, and matching line content
     */
    public async searchContent(query: string, maxResults: number = 10): Promise<SearchResult[]> {
        const results: SearchResult[] = [];

        // Regular expression for search (case insensitive)
        const searchRegex = new RegExp(query, 'i');

        // Process each file in the repository
        const processDirectory = async (dirPath: string, relativePath: string = '') => {
            const entries = await fs.readdir(dirPath);

            for (const entry of entries) {
                // Skip git directory
                if (entry.startsWith('.git')) continue;

                const fullPath = path.join(dirPath, entry);
                const entryRelativePath = relativePath ? path.join(relativePath, entry) : entry;
                const stats = await fs.stat(fullPath);

                if (stats.isDirectory()) {
                    // Recursively search subdirectories
                    await processDirectory(fullPath, entryRelativePath);
                } else {
                    // Skip large files and binary files
                    if (stats.size > 1024 * 1024) continue;

                    try {
                        // Read file content
                        const fileContent = await fs.readFile(fullPath, 'utf-8');
                        const lines = fileContent.split('\n');

                        // Search through each line
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            if (searchRegex.test(line)) {
                                // Get context (lines before and after the match)
                                const contextLines = [];
                                for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
                                    if (j !== i) {
                                        contextLines.push(`${j + 1}: ${lines[j]}`);
                                    }
                                }

                                // Add to results
                                results.push({
                                    path: entryRelativePath,
                                    line: i + 1,
                                    content: line,
                                    context: contextLines
                                });

                                // Stop if we've reached the maximum number of results
                                if (results.length >= maxResults) {
                                    return;
                                }
                            }
                        }
                    } catch (error) {
                        this.context.logger.warn(`Error searching file ${fullPath}:`, error);
                    }
                }

                // Stop if we've reached the maximum number of results
                if (results.length >= maxResults) {
                    return;
                }
            }
        };

        try {
            await processDirectory(this.context.repoPath);
            return results;
        } catch (error) {
            this.context.logger.error('Error searching repository:', error);
            throw new Error(`Failed to search repository: ${(error as Error).message}`);
        }
    }
}
