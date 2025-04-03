import {simpleGit as simpleGitFn} from 'simple-git';
import {RepositoryContext} from './types.js';

export class RepositoryDiffer {
    private context: RepositoryContext;

    constructor(context: RepositoryContext) {
        this.context = context;
    }

    /**
     * Get diff between two branches or commits
     * @param base Base branch or commit
     * @param head Head branch or commit
     * @returns Formatted diff output
     */
    public async getDiff(base: string, head: string): Promise<string> {
        try {
            const git = simpleGitFn(this.context.repoPath);

            // Make sure we have both commits/branches
            try {
                await git.fetch('origin', base);
                await git.fetch('origin', head);
            } catch (error) {
                this.context.logger.warn('Error fetching branches/commits:', error);
                // Continue anyway, as they might be local branches
            }

            // Get the diff
            const diffResult = await git.diff([base, head]);

            if (!diffResult || diffResult.trim() === '') {
                return `No differences found between ${base} and ${head}`;
            }

            return diffResult;
        } catch (error) {
            this.context.logger.error('Error getting diff:', error);
            throw new Error(`Failed to get diff between ${base} and ${head}: ${(error as Error).message}`);
        }
    }
}
