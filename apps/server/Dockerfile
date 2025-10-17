# inital base image
FROM continuumio/miniconda3
# update pip to minimize dependency errors 
RUN pip install --upgrade pip
# define the present working directory

RUN apt update
RUN apt install default-jdk -y
# Clone the repo into /SYNBICT (absolute path in the image)
RUN git clone --branch SYNBICT2 --single-branch --depth 1 \
      https://github.com/SD2E/SYNBICT /SYNBICT
WORKDIR /SYNBICT

# Use bash so `conda activate` works within the same RUN
SHELL ["/bin/bash", "-lc"]

# Create env and install everything inside it in one layer
RUN conda env create -f environment.yml && \
    echo "conda activate synbict_conda" >> ~/.bashrc && \
    conda activate synbict_conda && \
    pip install "sbol2>=1.3" "dnaplotlib>=1.0" && \
    pip install .

# Make the env the default PATH for subsequent layers/containers
ENV PATH=/opt/conda/envs/synbict_conda/bin:$PATH

WORKDIR /docker-flask-api
# copy the contents into the working dir
ADD . /docker-flask-api
# run pip to install the dependencies of the flask app
RUN pip install -r requirements.txt

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
