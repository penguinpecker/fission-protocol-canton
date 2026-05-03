FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY keeper.ts ./
COPY ../../backend/src/lib ./lib
CMD ["npx", "tsx", "keeper.ts"]
