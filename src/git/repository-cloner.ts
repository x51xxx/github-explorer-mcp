import {promises as fs} from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {simpleGit as simpleGitFn} from 'simple-git';
import * as os from 'os';
import {rm} from 'fs/promises';
import * as types from "simple-git";

import {McpLogger} from '../logger.js';

export class RepositoryCloner {
    private logger: McpLogger;

    constructor(logger: McpLogger) {
        this.logger = logger.child('RepositoryCloner');
    }

    /**
     * Extract base URL (for metadata fetching and cloning)
     */
    public extractBaseUrl(url: string): string {
        return url.replace(/\/tree\/.*$/, '');
    }

    /**
     * Normalize Git URL to handle different formats
     */
    private normalizeUrl(url: string): string {
        return url.replace(/\.git$/, '').replace(/\/$/, '');
    }

    /**
     * Extract branch from URL if present
     */
    public extractBranch(url: string): string | null {
        const match = url.match(/\/tree\/([^/]+)/);
        return match ? match[1] : null;
    }

    /**
     * Clone repository locally
     */
    public async cloneRepository(url: string): Promise<string> {
        // Create a deterministic directory name based on repo URL
        const repoHash = crypto
            .createHash('sha256')
            .update(url)
            .digest('hex')
            .substring(0, 12);

        const tempDir = path.join(os.tmpdir(), `git_explorer_${repoHash}`);
        const baseUrl = this.extractBaseUrl(url);
        const branch = this.extractBranch(url);

        // If directory exists and is a valid git repo, return it
        if (await fs.stat(tempDir).catch(() => false)) {
            try {
                const git = simpleGitFn(tempDir);
                const remotes = await git.getRemotes(true);
                const remoteUrl = remotes.find((r: types.RemoteWithRefs) => r.name === 'origin')?.refs.fetch;

                if (remoteUrl && this.normalizeUrl(remoteUrl) === this.normalizeUrl(baseUrl)) {
                    this.logger.debug(`Reusing existing repository at ${tempDir}`);

                    // Update to latest if a branch is specified
                    if (branch) {
                        const localGit = simpleGitFn(tempDir);
                        await localGit.fetch('origin');
                        try {
                            await localGit.checkout(branch);
                        } catch (error) {
                            this.logger.warn(`Error checking out branch ${branch}:`, error);
                        }
                    }

                    return tempDir;
                }
            } catch (error) {
                this.logger.warn('Error checking existing repository:', error);
                // If there's any error with existing repo, clean it up
                await rm(tempDir, {recursive: true, force: true});
            }
        }

        // Create directory and clone repository
        await fs.mkdir(tempDir, {recursive: true});
        try {
            this.logger.debug(`Cloning repository ${url} to ${tempDir}`);
            const git = simpleGitFn();
            await git.clone(baseUrl, tempDir);

            // Checkout specific branch if provided
            if (branch) {
                const localGit = simpleGitFn(tempDir);
                await localGit.checkout(branch);
            }

            return tempDir;
        } catch (error) {
            // Clean up on error
            await rm(tempDir, {recursive: true, force: true});
            throw new Error(`Failed to clone repository: ${(error as Error).message}`);
        }
    }
}
