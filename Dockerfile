FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build project
RUN npm run build

FROM node:22-alpine AS release

WORKDIR /app

# Copy built files and package info
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package*.json /app/

# Install only production dependencies
ENV NODE_ENV=production
RUN npm ci --omit=dev

# Set executable permissions
RUN chmod +x /app/dist/cli.js
RUN chmod +x /app/dist/cli-with-polyfill.js
RUN chmod +x /app/dist/index.js
RUN chmod +x /app/dist/sse.js

# Default to web mode for Docker
EXPOSE 3000
CMD ["node", "dist/cli-with-polyfill.js", "web", "--port", "3000"]
