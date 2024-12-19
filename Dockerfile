FROM node:18

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

COPY index.html ./dist
COPY public ./dist/public
COPY .env ./dist

WORKDIR ./dist

EXPOSE 3000

CMD ["node", "server.js"]
