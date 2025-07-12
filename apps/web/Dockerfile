# --- Builder Stage ---
# This stage builds the application
FROM node:18-alpine AS builder
WORKDIR /app

# Copy the entire monorepo context
# This includes all apps and packages
COPY . .

# Install all dependencies from the root of the monorepo
# This correctly links workspace packages like 'text-ranger'
RUN npm install

# Build the 'web' application using Turborepo
RUN npm run build -- --filter=web

# --- Production Stage ---
# This stage creates the final, lean image
FROM nginx:alpine

# Copy built assets from the builder stage
# The output for the 'web' app is in 'apps/web/dist'
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy the nginx configuration file
# The path is relative to the build context (monorepo root)
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80 and start nginx
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"] 