FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git zip ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
CMD ["node", "dist/index.js"]
