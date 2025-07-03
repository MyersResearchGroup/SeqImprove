<p align="center">
  <img src="https://github.com/user-attachments/assets/4b56ae5e-bb7c-474b-877d-a5f0946f58b6" alt="SeqImprove" width="355"/>
</p>

# Table of Contents

1.  [SeqImprove](#org90173bd)
    1.  [Motivation](#orgbde062b)
    2.  [Repository Structure](#org59abea7)
    3.  [Getting Started with Development](#org457403a)
    4.  [Running the Backend](#orgfaab638)
    5.  [Running the Frontend](#org41a114d)
    6.  [Deployment](#orgc9d1db5)
        1.  [Deploying the Frontend](#org4298ae7)
        2.  [Deploying to Backend](#org8f7e82e)

<a id="org90173bd"></a>

# SeqImprove

SeqImprove is an application for curating and SBOL designs. It can be run as a standalone app and as a SynBioHub curation plugin. It is meant to help users easily add metadata to their genetic designs by providing recommendations and a simple interface with which to do so.


<a id="orgbde062b"></a>

## Motivation

This project is a prototype based on the proposal by [Jet Mante](https://geneticlogiclab.org/author/jet-mante/) in her [doctoral thesis](https://www.biorxiv.org/content/10.1101/2023.04.25.538300v1.full). The proposal was inspired by a lack of standardization in the way genetic designs are annotated and published, making it difficult to study and reuse them.


<a id="org59abea7"></a>

## Repository Structure

This repository is a monorepo containing two applications and a package. The two applications are a React frontend and a Dockerized Python/Flask API that functions as the backend. The package is called text-ranger and was developed to make working with text ranges and replacements easier, as this is key functionality for creating and displaying text annotations for genetic designs.

This project uses [Turborepo](https://turbo.build/) to manage the monorepo.


<a id="org457403a"></a>

## Getting Started with Development

First clone the repository

    git clone https://github.com/MyersResearchGroup/SeqImprove.git

Navigate to `/apps/web/` and install dependencies:

    cd SeqImprove/apps/web
    npm install

Now you'll need to define environment variables. Create two files: `SeqImprove/apps/web/.env.development` and `SeqImprove/apps/web/.env.production`.

Open `SeqImprove/apps/web/.env.development` in your text editor and write the following:

    VITE_API_LOCATION=http://localhost:5001

Confirm that the port number you use, (5001 in this case), is the same as the port number used by the backend. Go to `SeqImprove/apps/server/Dockerfile` and look for the last line of the file. There you will find the port number, which should match the one in your environment file.

    CMD ["waitress-serve", "--port=5001", "--call", "app:create_app"]

Ask a teammate about the production API location.


<a id="orgfaab638"></a>

## Running the Backend

To run the backend you can follow these steps:

1.  Install Visual Studio Code
2.  In VS Code, install the Microsoft DevContainers extension.
3.  Open the directory `SeqImprove/apps/server` inside VS code.
4.  On a Mac, enter ⌘⇧p (Command Shift p) to bring up the command palette in VS Code. On a windows machine, replace Command with Control.
5.  From the command palette, search for something like `DevContainers: Rebuild Container`. If it says build instead of rebuild and reopen that's okay.
6.  Once the container finishes building, open a terminal in VS Code
7.  In the terminal, you should be given a prompt like this: `root@b8e4efb3fc3b:/workspaces/SeqImprove/apps/server#`. Look at the `CMD` in the last line of `SeqImprove/apps/server/Dockerfile`. Enter the command in the terminal:
    
        waitress-serve --port=5001 --call app:create_app

Now the backend is running. When you make changes, you do not need to rebuild the container. If the backend crashes because of an error, you can restart it the same way you started it:

    waitress-serve --port=5001 --call app:create_app


<a id="org41a114d"></a>

## Running the Frontend

    cd SeqImprove/apps/web
    npm run dev

Now, SeqImprove should be available at <http://localhost:5173>. Open this URL in your browser.


<a id="orgc38d955"></a>

### Frontend

This is a React app, so you will need to study [ReactJS](https://react.dev/) as well as a library called [Zustand](https://github.com/pmndrs/zustand).


<a id="orgc9d1db5"></a>
<!--
This is a
multiline comment

## Deployment


<a id="org4298ae7"></a>

### Deploying the Frontend

Ask a teammate about the deployment token

1.  Run `npm run build` from `apps/web`
2.  Run `npm run deploy -- --env production --deployment-token <INSERT-DEPLOYMENT-TOKEN-HERE>` from `apps/web`.


<a id="org8f7e82e"></a>

### Deploying to Backend

The server is just a Docker container that Azure pulls from Docker Hub, so to deploy, you just have to push to Docker hub. All you have to do is

1.  Log in to the SynBioSuite docker account via the command line. 
    (I think the command is `docker login`. Ask a teammate for the username and password.)
2.  Run `./build.sh` from apps/server
    (If you get an error complaining you don't have permission to execute this file, then run `chmod +x ./build.sh` first)
3.  Run `./deploy.sh` from apps/server
    (If you get an error complaining you don't have permission to execute this file, then run `chmod +x ./deploy.sh` first.)

Azure might take a second to start using the updated container.
-->
