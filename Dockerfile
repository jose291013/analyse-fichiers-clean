FROM node:18-slim

RUN apt-get update && apt-get install -y qpdf ghostscript && apt-get clean

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Créer tous les dossiers nécessaires
RUN mkdir -p /app/uploads /app/pdfs /app/modified /app/thumbnails

EXPOSE 3000

CMD ["node", "server.js"]

