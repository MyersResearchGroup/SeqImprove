
# SeqImprove

SeqImprove is an application for curating and SBOL designs. It can be run as a standalone
app and as a SynBioHub curation plugin. It is meant to help users easily add metadata 
to their genetic designs by providing recommendations and a simple interface with which
to do so.
## Motivation

This project is a prototype based on the proposal by [Jet Mante](https://geneticlogiclab.org/author/jet-mante/)
in her [doctoral thesis](https://www.biorxiv.org/content/10.1101/2023.04.25.538300v1.full). The proposal was inspired by a lack of
standardization in the way genetic designs are annotated and published, making it
difficult to study and reuse them.
## Repository Structure

This repository is a monorepo containing two applications and a package. The two
applications are a React frontend and a Dockerized Express/Node.js API that functions as the 
backend. The package is called text-ranger and was developed to make working with
text ranges and replacements easier, as this is key functionality for creating
and displaying text annotations for genetic designs.

This project uses [Turborepo](https://turbo.build/) to manage the monorepo.
## Run Locally

Clone the project

```bash
git clone https://github.com/zachsents/SeqImprove
```

Go to the project directory

```bash
cd SeqImprove
```

Install dependencies

```bash
npm install
```

Start the frontend development server

```bash
npm run dev -w web
```

Navigate to the backend

```bash
cd apps/server
```

Build the Docker container

```bash
docker build -t seqimprove .
```

Run the Docker container

```bash
docker run -p 5000:5000 seqimprove
```

The API will be available on port 5000 and the frontend application will be 
served at [http://localhost:5173](http://localhost:5173).
## Building for Deployment

From the root directory, to build the frontend, run

```bash
npm run build -w web
```

The built output will be in apps/web/dist, ready to be hosted anywhere you can host
a static web app. Try [Azure Static Web Apps](https://azure.microsoft.com/en-us/products/app-service/static/).

To build the backend, run

```bash
docker build -t seqimprove ./apps/server
```

The resulting image can be used to deploy the API anywhere you can run a Docker container.
Try [Azure Container Apps](https://azure.microsoft.com/en-us/products/container-apps/v).
## Environment Variables

For the frontend, you will need the following environment variable in a .env file
(within the apps/web directory):

`VITE_API_LOCATION` URL for the API. For local development, will be `http://localhost:5000`.

For the backend, you will need the following environment variable in a .env file
(within the apps/server directory):

`FRONTEND_LOCATION` URL for the frontend. For local development, will be `http://localhost:5173`.


## Development

When developing, it's easiest to use VSCode with the Dev Containers extension from Microsoft installed. This way, the backend server can be hot reloaded. This avoids having to rebuild the Docker container between every change.

##### Front End
For the frontend, you can develop like normal using the development server `npm run dev` from within `apps/web` or `npm run dev -w web` from within the root directory of the project.

##### Backend
First, open server directory in VS Code
Then: type `CMD-Shift-p` → `Dev Containers: Build & Reopen Container`

Once inside the container, you can open a terminal within VS Code, navigate to the `apps/server` directory and use `npm run dev` to start the backend server.
