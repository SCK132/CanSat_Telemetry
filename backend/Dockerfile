FROM node:18-alpine

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY tsconfig.json ./

# Copy workspace package.json files
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/

# Install dependencies
RUN npm install

# Copy source code
COPY shared/ ./shared/
COPY backend/ ./backend/

# Expose UDP and WS ports
EXPOSE 5000/udp
EXPOSE 8080

# Run the backend
CMD ["npm", "run", "dev:backend"]
