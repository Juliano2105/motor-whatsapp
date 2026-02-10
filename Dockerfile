FROM node:20-bullseye-slim

# Instala dependências do sistema para o WhatsApp
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia arquivos de dependências
COPY package*.json ./

# Instala as dependências ignorando erros de scripts antigos
RUN npm install --network-timeout=100000

# Copia o restante do código
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
