# Dedicated Server für Kantenhain (läuft auf x86_64 und ARM64).
# Bauen:  docker build -t kantenhain-server .
# Start:  docker run -d --name kantenhain -p 25580:25580 -v kantenhain-data:/data --memory=512m kantenhain-server
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY core ./core
COPY src ./src
COPY server ./server
RUN npx esbuild server/index.ts --bundle --platform=node --format=esm --target=node18 --external:ws --outfile=server/dist/server.mjs

FROM node:22-alpine
WORKDIR /app
RUN npm install --omit=dev ws@8 && npm cache clean --force
COPY --from=build /app/server/dist/server.mjs ./server.mjs
ENV NODE_OPTIONS=--max-old-space-size=384 KANTENHAIN_CONFIG=/data/server.config.json
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 25580
USER node
CMD ["node", "server.mjs"]
