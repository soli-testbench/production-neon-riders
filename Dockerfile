FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build
RUN npx tsc -p tsconfig.server.json --outDir dist/server --noEmit false

FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 8080

ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "dist/server/server/index.js"]
