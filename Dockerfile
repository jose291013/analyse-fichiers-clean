FROM node:18-slim

# Installer qpdf, ghostscript, et imagemagick
RUN apt-get update && apt-get install -y qpdf ghostscript imagemagick && apt-get clean

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Créer tous les dossiers nécessaires
RUN mkdir -p /app/uploads /app/pdfs /app/modified /app/thumbnails

EXPOSE 3000

CMD ["node", "server.js"]


