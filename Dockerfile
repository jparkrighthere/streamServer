FROM node:18-bookworm-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-setuptools \
    build-essential \
    pkg-config \
    libtool \
    git \
    cmake \
    ninja-build \
    clang \
    libglib2.0-dev \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./

# --build-from-source 옵션 꼭 필요
RUN npm install --build-from-source --verbose

COPY . .

RUN npm run build

EXPOSE 4000

CMD ["node", "dist/server.js"]
