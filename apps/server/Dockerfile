# Conda-based image so we can install SYNBICT's bioinformatics deps
# (minimap2, bwa, blast, emboss, prokka deps, perl modules, gsl) via environment.yml
FROM continuumio/miniconda3:latest

# System packages: JDK for SBOL tooling, build essentials, node for the
# get_annotations script, wget/git for cloning + fetching prokka tarball.
RUN apt-get update && apt-get install -y --no-install-recommends \
      default-jdk \
      build-essential \
      git \
      wget \
      ca-certificates \
      curl \
      nodejs \
      npm \
 && rm -rf /var/lib/apt/lists/*

# --- SYNBICT install via conda env ---
# Clone the SYNBICT2 branch which has the new aligners (Prokka/Minimap2/Blast/MmSeq/VSearch)
# and the updated environment.yml.
RUN git clone -b SYNBICT2 https://github.com/SD2E/SYNBICT /SYNBICT
WORKDIR /SYNBICT

# Create the conda env defined in SYNBICT/environment.yml (name: synbict_conda, python 3.11)
RUN conda env create -f environment.yml \
 && conda clean -afy

# Make every subsequent RUN execute inside the synbict_conda env.
SHELL ["conda", "run", "--no-capture-output", "-n", "synbict_conda", "/bin/bash", "-c"]

# Install SYNBICT itself (pulls sbol2, dnaplotlib, etc. from PyPI into the env)
RUN pip install .

# --- Flask app ---
WORKDIR /docker-flask-api
ADD . /docker-flask-api
RUN pip install -r requirements.txt

# --- Prokka 1.14.6 ---
# ProkkaAligner.py uses shutil.which("prokka"); we just need it on PATH.
# Conda already provides hmmer/aragorn/barrnap/minced/prodigal/perl-bioperl/gsl, so
# the prokka binary will find its runtime deps via the active env.
RUN wget -q https://github.com/tseemann/prokka/archive/refs/tags/v1.14.6.tar.gz \
 && tar xzf v1.14.6.tar.gz \
 && rm v1.14.6.tar.gz

ENV PATH=/opt/conda/envs/synbict_conda/bin:/docker-flask-api/prokka-1.14.6/bin:$PATH

# Build BLAST indexes for prokka's bundled DBs (uses the prokka install at $FindBin/../db)
RUN prokka --setupdb && prokka --listdb

# --- Node deps for get_annotations script ---
WORKDIR /docker-flask-api/assets/scripts/get_annotations
RUN npm install sbolgraph

WORKDIR /docker-flask-api

# `conda run` wrapper ensures waitress launches inside the synbict_conda env.
CMD ["conda", "run", "--no-capture-output", "-n", "synbict_conda", \
     "waitress-serve", "--port=5000", "--call", "app:create_app"]
