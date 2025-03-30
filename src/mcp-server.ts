import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  LoggingLevel,
  CompleteRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { GitIngester } from './git-ingester.js';

// Zod schemas for tool input validation
const GitSummarySchema = z.object({
  owner: z.string().describe("GitHub organization or username"),
  repo: z.string().describe("Repository name"),
  branch: z.string().optional().describe("Optional branch name"),
  includeMetadata: z.boolean().default(false).describe("Include stars, forks, etc.")
});

const GitTreeSchema = z.object({
  owner: z.string().describe("GitHub organization or username"),
  repo: z.string().describe("Repository name"),
  branch: z.string().optional().describe("Optional branch name")
});

const GitFilesSchema = z.object({
  owner: z.string().describe("GitHub organization or username"),
  repo: z.string().describe("Repository name"),
  filePaths: z.array(z.string()).describe("List of paths to files"),
  branch: z.string().optional().describe("Optional branch name"),
  format: z.enum(["text", "json"]).default("text").describe("Output format")
});

const GitSearchSchema = z.object({
  owner: z.string().describe("GitHub organization or username"),
  repo: z.string().describe("Repository name"),
  query: z.string().describe("Search query"),
  branch: z.string().optional().describe("Optional branch name"),
  maxResults: z.number().default(10).describe("Maximum results to return")
});

const GitDiffSchema = z.object({
  owner: z.string().describe("GitHub organization or username"),
  repo: z.string().describe("Repository name"),
  base: z.string().describe("Base branch/commit"),
  head: z.string().describe("Head branch/commit")
});

// Example completions for repositories
const EXAMPLE_COMPLETIONS = {
  owner: ["github", "microsoft", "google", "facebook", "apache", "kubernetes"],
  repo: ["vscode", "react", "tensorflow", "kubernetes", "angular"]
};

// Tools enum
enum ToolName {
  REPO_SUMMARY = "github_repository_summary",
  REPO_STRUCTURE = "github_directory_structure",
  READ_FILES = "github_read_important_files",
  SEARCH = "git_search",
  DIFF = "git_diff"
}

export const createServer = () => {
  // Initialize MCP server
  const server = new Server({
    name: "github-explorer-mcp",
    version: "0.1.0",
  }, {
    capabilities: {
      tools: {},
      logging: {}
    }
  });

  // Set up logging level
  let logLevel: LoggingLevel = "info";

  // Register tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: ToolName.REPO_SUMMARY,
          description: "Get a summary of a GitHub repository",
          inputSchema: zodToJsonSchema(GitSummarySchema),
        },
        {
          name: ToolName.REPO_STRUCTURE,
          description: "Get the tree structure of a GitHub repository with a nice ASCII tree visualization",
          inputSchema: zodToJsonSchema(GitTreeSchema),
        },
        {
          name: ToolName.READ_FILES,
          description: "Get the content of specific files from a GitHub repository",
          inputSchema: zodToJsonSchema(GitFilesSchema),
        },
        {
          name: ToolName.SEARCH,
          description: "Search for content within a GitHub repository (coming soon)",
          inputSchema: zodToJsonSchema(GitSearchSchema),
        },
        {
          name: ToolName.DIFF,
          description: "Get a diff between two branches or commits (coming soon)",
          inputSchema: zodToJsonSchema(GitDiffSchema),
        }
      ]
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args, _meta } = request.params;

    // Handle repository summary
    if (name === ToolName.REPO_SUMMARY) {
      const { owner, repo, branch, includeMetadata } = GitSummarySchema.parse(args);
      const url = `https://github.com/${owner}/${repo}`;

      try {
        if (_meta?.progressToken) {
          await server.notification({
            method: "notifications/progress",
            params: {
              progress: 1,
              total: 4,
              progressToken: _meta.progressToken,
            }
          });
        }

        const ingester = new GitIngester(url, branch);

        if (_meta?.progressToken) {
          await server.notification({
            method: "notifications/progress",
            params: {
              progress: 2,
              total: 4,
              progressToken: _meta.progressToken,
            }
          });
        }

        await ingester.fetchRepoData();

        if (_meta?.progressToken) {
          await server.notification({
            method: "notifications/progress",
            params: {
              progress: 3,
              total: 4,
              progressToken: _meta.progressToken,
            }
          });
        }

        let summary = ingester.getSummary() || '';

        // Fetch additional metadata if requested
        if (includeMetadata) {
          const metadata = await ingester.fetchMetadata();
          summary += `\n\nStars: ${metadata.stars}\n`;
          summary += `Forks: ${metadata.forks}\n`;
          summary += `Description: ${metadata.description}\n`;
          summary += `Last Updated: ${metadata.lastUpdated}\n`;
        }

        try {
          // Try to fetch README.md
          const readmeContent = ingester.getFilesContent(['README.md']);
          if (readmeContent && readmeContent.includes('README.md')) {
            summary = `${summary}\n\n${readmeContent}`;
          }
        } catch (error) {
          console.warn('Error fetching README:', error);
        }

        if (_meta?.progressToken) {
          await server.notification({
            method: "notifications/progress",
            params: {
              progress: 4,
              total: 4,
              progressToken: _meta.progressToken,
            }
          });
        }

        return {
          content: [{ type: "text", text: summary }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get repository summary: ${error.message}`,
            annotations: {
              priority: 1.0,
              audience: ["user", "assistant"]
            }
          }]
        };
      }
    }

    // Handle repository structure
    if (name === ToolName.REPO_STRUCTURE) {
      const { owner, repo, branch } = GitTreeSchema.parse(args);
      const url = `https://github.com/${owner}/${repo}`;

      try {
        if (_meta?.progressToken) {
          await server.notification({
            method: "notifications/progress",
            params: {
              progress: 1,
              total: 2,
              progressToken: _meta.progressToken,
            }
          });
        }

        const ingester = new GitIngester(url, branch);
        await ingester.fetchRepoData();

        if (_meta?.progressToken) {
          await server.notification({
            method: "notifications/progress",
            params: {
              progress: 2,
              total: 2,
              progressToken: _meta.progressToken,
            }
          });
        }

        const tree = ingester.getTree() || '';
        return {
          content: [{
            type: "text",
            text: tree,
            annotations: {
              audience: ["user", "assistant"]
            }
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get repository tree: ${error.message}`,
            annotations: {
              priority: 1.0,
              audience: ["user", "assistant"]
            }
          }]
        };
      }
    }

    // Handle file content
    if (name === ToolName.READ_FILES) {
      const { owner, repo, filePaths, branch, format } = GitFilesSchema.parse(args);
      const url = `https://github.com/${owner}/${repo}`;

      try {
        if (_meta?.progressToken) {
          await server.notification({
            method: "notifications/progress",
            params: {
              progress: 1,
              total: 3,
              progressToken: _meta.progressToken,
            }
          });
        }

        const ingester = new GitIngester(url, branch);

        if (_meta?.progressToken) {
          await server.notification({
            method: "notifications/progress",
            params: {
              progress: 2,
              total: 3,
              progressToken: _meta.progressToken,
            }
          });
        }

        await ingester.fetchRepoData();

        if (_meta?.progressToken) {
          await server.notification({
            method: "notifications/progress",
            params: {
              progress: 3,
              total: 3,
              progressToken: _meta.progressToken,
            }
          });
        }

        if (format === 'json') {
          const filesContent = ingester.getFilesAsObjects(filePaths);
          if (filesContent.length === 0) {
            return {
              content: [{
                type: "text",
                text: 'None of the requested files were found in the repository',
                annotations: {
                  priority: 0.8,
                  audience: ["user", "assistant"]
                }
              }]
            };
          }

          return {
            content: [{
              type: "text",
              text: JSON.stringify(filesContent, null, 2)
            }]
          };
        } else {
          const filesContent = ingester.getFilesContent(filePaths);
          if (!filesContent) {
            return {
              content: [{
                type: "text",
                text: 'None of the requested files were found in the repository',
                annotations: {
                  priority: 0.8,
                  audience: ["user", "assistant"]
                }
              }]
            };
          }

          return {
            content: [{ type: "text", text: filesContent }]
          };
        }
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get file content: ${error.message}`,
            annotations: {
              priority: 1.0,
              audience: ["user", "assistant"]
            }
          }]
        };
      }
    }

    // Handle search (placeholder)
    if (name === ToolName.SEARCH) {
      GitSearchSchema.parse(args);
      return {
        content: [{
          type: "text",
          text: 'Search functionality is not yet implemented',
          annotations: {
            priority: 0.5,
            audience: ["user", "assistant"]
          }
        }]
      };
    }

    // Handle diff (placeholder)
    if (name === ToolName.DIFF) {
      GitDiffSchema.parse(args);
      return {
        content: [{
          type: "text",
          text: 'Diff functionality is not yet implemented',
          annotations: {
            priority: 0.5,
            audience: ["user", "assistant"]
          }
        }]
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  // Handle auto-completion
  server.setRequestHandler(CompleteRequestSchema, async (request) => {
    const { argument } = request.params;

    // Handle completion for arguments
    const completions = EXAMPLE_COMPLETIONS[argument.name as keyof typeof EXAMPLE_COMPLETIONS];
    if (!completions) return { completion: { values: [] } };

    const values = completions.filter(value =>
      value.toLowerCase().startsWith(argument.value.toLowerCase())
    );

    return {
      completion: {
        values,
        hasMore: false,
        total: values.length
      }
    };
  });

  // Set up random logging for debugging
  const logInterval = setInterval(() => {
    server.notification({
      method: "notifications/message",
      params: {
        level: "debug",
        logger: "github-explorer",
        data: `Active at ${new Date().toISOString()}`,
      },
    });
  }, 60000); // Log every minute

  // Cleanup function
  const cleanup = () => {
    clearInterval(logInterval);
  };

  return { server, cleanup };
};
