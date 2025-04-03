import {promises as fs} from 'fs';
import * as path from 'path';
import {RepositoryContext, RepoSummary} from './types.js';

export class RepositoryAnalyzer {
    private context: RepositoryContext;

    constructor(context: RepositoryContext) {
        this.context = context;
    }

    /**
     * Generate a tree-like directory structure string
     */
    public async generateDirectoryTree(dirPath: string, prefix: string = ""): Promise<string> {
        let output = "";
        const entries = await fs.readdir(dirPath);
        entries.sort();

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (entry.startsWith('.git')) {
                continue;
            }

            const isLast = i === entries.length - 1;
            const currentPrefix = isLast ? "└── " : "├── ";
            const nextPrefix = isLast ? "    " : "│   ";

            const entryPath = `${dirPath}/${entry}`;
            const stats = await fs.stat(entryPath);

            output += prefix + currentPrefix + entry + "\n";

            if (stats.isDirectory()) {
                output += await this.generateDirectoryTree(entryPath, prefix + nextPrefix);
            }
        }

        return output;
    }

    /**
     * Count files in a directory
     */
    public async countFiles(dir: string): Promise<number> {
        let count = 0;
        const entries = await fs.readdir(dir);

        for (const entry of entries) {
            if (entry.startsWith('.git')) continue;

            const fullPath = path.join(dir, entry);
            const stats = await fs.stat(fullPath);

            if (stats.isDirectory()) {
                count += await this.countFiles(fullPath);
            } else {
                count++;
            }
        }

        return count;
    }

    /**
     * Read repository content
     */
    public async readRepositoryContent(repoPath: string): Promise<string> {
        let content = '';

        const processFile = async (filePath: string, relativePath: string) => {
            try {
                const fileContent = await fs.readFile(filePath, 'utf-8');
                content += `==================================================\n`;
                content += `File: ${relativePath}\n`;
                content += `==================================================\n`;
                content += fileContent + '\n\n';
            } catch (error) {
                this.context.logger.warn(`Error reading file ${filePath}:`, error);
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
     * Extract repository name from URL
     */
    public extractRepoName(url: string): string {
        return url.replace('https://github.com/', '').split('/tree/')[0];
    }

    /**
     * Parse summary string into structured object
     */
    public parseSummary(summaryStr: string): RepoSummary {
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
            this.context.logger.error('Error parsing summary:', error);
        }

        return summaryDict;
    }

    /**
     * Get content of specific files
     */
    public extractFilesContent(content: string, filePaths: string[]): string {
        if (!content) {
            return "";
        }

        const result: Record<string, string | null> = {};
        filePaths.forEach(path => {
            result[path] = null;
        });

        const contentStr = content.toString();

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
}
