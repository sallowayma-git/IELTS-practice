FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev

WORKDIR /app
COPY assets ./assets
COPY css ./css
COPY js ./js
COPY templates ./templates
COPY index.html ./index.html
COPY backend ./backend

WORKDIR /app/backend
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["sh", "-c", "node scripts/migrate.mjs && node scripts/bootstrap-admin.mjs && node src/server.js"]
