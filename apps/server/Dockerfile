FROM python:3.10

# use same shell for each run command to help with installation
SHELL ["/bin/bash", "--login", "-c"]

# install NVM and Node 16
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash
RUN nvm install 16

# clone SYNBICT at root & install deps
RUN git clone https://github.com/SD2E/SYNBICT
RUN python SYNBICT/setup.py install

# move into work dir
WORKDIR /SeqImprove

# copy over app files
COPY . .

# install Node deps
RUN npm install

ENTRYPOINT npm start