# init a base image
FROM python:3.10-bookworm
# update pip to minimize dependency errors 
RUN pip install --upgrade pip
# define the present working directory

RUN apt update
RUN apt install default-jdk -y

# clone SYNBICT at root & install deps
RUN pip install sbol2==1.3
RUN git clone https://github.com/SD2E/SYNBICT
WORKDIR /SYNBICT
RUN python3 setup.py install

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
