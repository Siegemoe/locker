FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm db:generate && pnpm build
ENV NODE_ENV=production
# The artifact volume and Next's build cache must be writable at runtime.
RUN mkdir -p /var/lib/spore-locker/artifacts && chown -R node:node /var/lib/spore-locker /app/.next
USER node
EXPOSE 3000 8787
CMD ["pnpm", "start"]
