
# ==========================================
# Stage 1: Build React frontend
# ==========================================
FROM node:20-bookworm AS frontend

WORKDIR /build

COPY package*.json ./
COPY apps/web ./apps/web
COPY packages ./packages

RUN npm install

RUN rm -rf /build/apps/web/node_modules/.vite \
           /build/node_modules/.vite

RUN cd apps/web && \
    NODE_OPTIONS="--max-old-space-size=8192" \
    VITE_API_LOCATION="" \
    npm run build
    
# ==========================================
# Stage 2: Python/Conda backend + Nginx
# ==========================================
FROM continuumio/miniconda3:latest

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        default-jdk \
        build-essential \
        git \
        wget \
        ca-certificates \
        curl \
        nodejs \
        npm \
        nginx \
        supervisor \
    && rm -rf /var/lib/apt/lists/*

# ==========================================
# Install SYNBICT
# ==========================================
RUN git clone -b SYNBICT2 \
    https://github.com/SD2E/SYNBICT /SYNBICT

WORKDIR /SYNBICT

RUN conda env create -f environment.yml && \
    conda clean -afy

SHELL ["conda", "run", "--no-capture-output", \
       "-n", "synbict_conda", "/bin/bash", "-c"]

RUN pip install .

# ==========================================
# Install SeqImprove backend
# ==========================================
WORKDIR /docker-flask-api

COPY apps/server/ /docker-flask-api/

RUN pip install -r requirements.txt

# ==========================================
# Install Prokka
# ==========================================
RUN wget -nv --tries=5 --waitretry=15 \
    --retry-connrefused \
    --retry-on-http-error=408,429,500,502,503,504 \
    https://github.com/tseemann/prokka/archive/refs/tags/v1.14.6.tar.gz \
    && tar xzf v1.14.6.tar.gz \
    && rm v1.14.6.tar.gz

ENV PATH="/docker-flask-api/prokka-1.14.6/bin:/opt/conda/envs/synbict_conda/bin:${PATH}"

RUN prokka --setupdb && prokka --listdb

# Install Node dependencies for annotations
WORKDIR /docker-flask-api/assets/scripts/get_annotations

RUN npm install sbolgraph

# ==========================================
# Install compiled React frontend
# ==========================================
COPY --from=frontend /build/apps/web/dist/ \
    /usr/share/nginx/html/

# ==========================================
# Configure Nginx and Supervisor
# ==========================================
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/seqimprove.conf

RUN rm -f /etc/nginx/sites-enabled/default

WORKDIR /docker-flask-api

ENV SEQIMPROVE_THREADS=8
ENV PYTHONUNBUFFERED=1

EXPOSE 5001

CMD ["/usr/bin/supervisord", "-n", \
     "-c", "/etc/supervisor/conf.d/seqimprove.conf"]
