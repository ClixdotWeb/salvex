# Salvex website for Coolify: builds the React app and serves it with nginx.
# /api, /docs and /openapi.json are forwarded to the backend, so the browser sees ONE domain
# (secure cookies work and no CORS setup is needed).
#
# Build arguments (set in Coolify): VITE_COMPANY_PHONE, VITE_COMPANY_WHATSAPP, VITE_COMPANY_EMAIL,
#   VITE_COMPANY_ADDRESS, VITE_COMPANY_CITY
# Runtime environment: BACKEND_URL = internal address of the API container, e.g. http://salvex-api:8000
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_COMPANY_PHONE=""
ARG VITE_COMPANY_WHATSAPP=""
ARG VITE_COMPANY_EMAIL=""
ARG VITE_COMPANY_ADDRESS=""
ARG VITE_COMPANY_CITY=""
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist /usr/share/nginx/html
ENV BACKEND_URL=http://salvex-api:8000
EXPOSE 80
