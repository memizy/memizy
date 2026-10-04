# The relay bundled into one file (deploy.sh builds dist/server.js).
FROM oven/bun:1-slim
WORKDIR /app
COPY dist/server.js .
USER bun
EXPOSE 8787
CMD ["bun", "server.js"]
