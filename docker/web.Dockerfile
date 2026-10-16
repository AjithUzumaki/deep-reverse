FROM node:20-slim AS base
WORKDIR /srv

COPY apps/web/package.json ./package.json
RUN npm install

COPY apps/web ./

EXPOSE 3000
CMD ["npm", "run", "dev"]
