# init a base image
FROM python:3.10-bookworm
# update pip to minimize dependency errors 
RUN pip install --upgrade pip
# define the present working directory

RUN apt update
RUN apt install default-jdk -y

# clone SYNBICT at root & install deps
RUN pip install "packaging<22.0" numpy==1.26.4 sbol2==1.3
RUN git clone https://github.com/SD2E/SYNBICT
WORKDIR /SYNBICT
RUN pip install .

WORKDIR /docker-flask-api
# copy the contents into the working dir
ADD . /docker-flask-api
# run pip to install the dependencies of the flask app
RUN pip install -r requirements.txt

# install Prokka 1.14.6 — ProkkaAligner expects ./prokka-1.14.6/bin/prokka
# relative to the server's working directory
RUN apt update && apt install -y \
    bioperl \
    ncbi-blast+ \
    hmmer \
    aragorn \
    barrnap \
    minced \
    prodigal \
    libdatetime-perl \
    libxml-simple-perl \
    libdigest-md5-perl \
 && rm -rf /var/lib/apt/lists/*
RUN wget https://github.com/tseemann/prokka/archive/refs/tags/v1.14.6.tar.gz \
 && tar xzf v1.14.6.tar.gz \
 && rm v1.14.6.tar.gz

# put prokka on PATH so subsequent steps can call it by name
ENV PATH="/docker-flask-api/prokka-1.14.6/bin:${PATH}"
# tell app.py which prokka to use (overrides the host conda default)
ENV PROKKA_BIN=/docker-flask-api/prokka-1.14.6/bin

# The SYNBICT prokka has the raw fasta files but they haven't been formatted into BLAST indexes 
# You can run it from anywhere — Prokka's --setupdb uses db/ relative to the binary's install location ($FindBin::RealBin/../db), not your CWD. So which prokka binary you invoke determines which install gets set up.
RUN prokka --setupdb \
 && prokka --listdb

# --- TENTATIVE / WIP: prokka env + conda deps (not done yet) ---
# cd prokka
# export PROKKA_HOME="$HOME/git_repo/SYNBICT/prokka"
# export PATH="$PATH:$PROKKA_HOME/bin"
#
# echo 'export PROKKA_HOME="$HOME/git_repo/SYNBICT/prokka"' >> ~/.bashrc
# echo 'export PATH="$PATH:$PROKKA_HOME/bin"' >> ~/.bashrc
# source ~/.bashrc
#
# prokka --setupdb
#
# conda install -c bioconda perl-xml-simple
# conda install -c bioconda perl-bioperl
# conda install -c conda-forge "gsl=2.5.*"
#
# conda install -c conda-forge -c bioconda \
#   openjdk \
#   perl-bioperl \
#   perl-datetime \
#   perl-xml-simple \
#   perl-digest-md5
# --- end tentative block ---

# install node
RUN apt update
RUN apt install nodejs npm -y

# install node dependencies
WORKDIR /docker-flask-api/assets/scripts/get_annotations
RUN npm install sbolgraph

# go back to server directory
WORKDIR /docker-flask-api

# define the command to start the container
# CMD ["python3","app.py"]
# waitress-serve --port=5001 --call app:create_app
CMD ["waitress-serve", "--port=5000", "--call", "app:create_app"]
