FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY . .

RUN mkdir -p /app/data
VOLUME /app/data

EXPOSE 3000

CMD ["node", "server.js"]