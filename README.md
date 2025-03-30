# GitHub Explorer MCP

The MCP server that provides GitHub repository information including file content, directory structure, and other metadata for MCP clients like Claude Desktop, Cursor, and others.

## Features

- **Repository Summaries**: Get comprehensive information about GitHub repositories
- **Directory Structure**: View the complete file structure of any repository with a nice ASCII tree visualization
- **File Content**: Access the content of specific files
- **Metadata Enhancement**: Get stars, forks, description, and last updated information
- **Local Repository Cloning**: Clone repositories locally for faster processing and more complete data
- **Caching System**: Efficiently cache repository data to reduce API calls
- **Progress Notifications**: Updates on long-running operations
- **Format Options**: Get data in text or structured JSON format
- **Auto-Completion**: Suggestions for repository owners and names
- **Web Interface**: Basic status page and info when running in HTTP mode

## Installation

### Using NPM

```bash
# Install from npm
npm install github-explorer-mcp -g

# Run the server (stdio mode for MCP clients)
github-explorer-mcp

# Or run in HTTP/SSE mode
github-explorer-mcp-sse
```

### Using Docker

```bash
# Build Docker image
docker build -t github-explorer-mcp .

# Run container
docker run -p 3000:3000 github-explorer-mcp
```

## Usage with MCP Clients

### Claude Desktop

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "github-explorer": {
      "command": "npx",
      "args": ["github-explorer-mcp"]
    }
  }
}
```

### Cursor

Add to your Cursor configuration:

```json
{
  "mcpServers": {
    "github-explorer": {
      "command": "npx",
      "args": ["github-explorer-mcp"]
    }
  }
}
```

## API Reference

The MCP server provides the following tools:

### github_repository_summary

Get a summary of a GitHub repository.

```typescript
{
  owner: string;    // GitHub organization or username
  repo: string;     // Repository name
  branch?: string;  // Optional branch name
  includeMetadata?: boolean; // Include stars, forks, etc.
}
```

### github_directory_structure

Get the tree structure of a GitHub repository.

```typescript
{
  owner: string;    // GitHub organization or username
  repo: string;     // Repository name
  branch?: string;  // Optional branch name
}
```

### github_read_important_files

Get the content of specific files from a GitHub repository.

```typescript
{
  owner: string;     // GitHub organization or username
  repo: string;      // Repository name
  filePaths: string[]; // List of paths to files
  branch?: string;   // Optional branch name
  format?: 'text' | 'json'; // Output format
}
```

### git_search (Coming Soon)

Search for content within a GitHub repository.

```typescript
{
  owner: string;     // GitHub organization or username
  repo: string;      // Repository name
  query: string;     // Search query
  branch?: string;   // Optional branch name
  maxResults?: number; // Maximum results to return
}
```

### git_diff (Coming Soon)

Get a diff between two branches or commits.

```typescript
{
  owner: string;     // GitHub organization or username
  repo: string;      // Repository name
  base: string;      // Base branch/commit
  head: string;      // Head branch/commit
}
```

## Development

```bash
# Clone the repository
git clone https://github.com/username/github-explorer-mcp.git
cd github-explorer-mcp

# Install dependencies
npm install

# IMPORTANT: This project requires Node.js 18 or later
# If using nvm, run:
nvm use

# Run in development mode (HTTP/SSE)
npm run start:sse

# Build the project
npm run build

# Run the built server
npm start
# or
npm run start:sse
```

## Troubleshooting

### Node.js Version Issues

This project requires Node.js 18 or newer because it uses modern Web APIs like `ReadableStream`. If you encounter errors like:

```
ReferenceError: ReadableStream is not defined
```

You should:

1. Update Node.js to version 18 or later
2. If using nvm, run `nvm use` in the project directory
3. Make sure to use the modified scripts that include necessary polyfills

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
