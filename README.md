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
    7.  [Developer & User Wiki](#developer--user-wiki)
        1.  [For Users](#for-users)
            1.  [What is SeqImprove?](#what-is-seqimprove)
            2.  [Key Features](#key-features)
            3.  [How to Use SeqImprove](#how-to-use-seqimprove)
            4.  [Supported File Formats](#supported-file-formats)
            5.  [Working with SynBioHub](#working-with-synbiohub)
        2.  [For Developers](#for-developers)
            1.  [Architecture Overview](#architecture-overview)
            2.  [Key Components](#key-components)
            3.  [Backend](#backend)
            4.  [API Reference](#api-reference)
            5.  [State Management](#state-management)
            6.  [Adding New Features](#adding-new-features)
            7.  [Testing](#testing)


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

## Developer & User Wiki

### Table of Contents
- [**For Users**](#for-users)
  - [What is SeqImprove?](#what-is-seqimprove)
  - [Key Features](#key-features)
  - [How to Use SeqImprove](#how-to-use-seqimprove)
  - [Supported File Formats](#supported-file-formats)
  - [Working with SynBioHub](#working-with-synbiohub)
- [**For Developers**](#for-developers)  
  - [Architecture Overview](#architecture-overview)
  - [Key Components](#key-components)
  - [API Reference](#api-reference)
  - [State Management](#state-management)
  - [Adding New Features](#adding-new-features)
  - [Testing](#testing)

## For Users

### What is SeqImprove?
SeqImprove is a web application designed to help synthetic biologists curate and annotate genetic designs in SBOL (Synthetic Biology Open Language) format. It provides automated annotation suggestions and an intuitive interface for adding metadata to genetic designs.

### Key Features
- **SBOL Document Curation**: Load, edit, and export SBOL documents with rich metadata
- **Automated Annotations**: Get AI-powered suggestions for sequence and text annotations  
- **SynBioHub Integration**: Connect to any SynBioHub instance for uploading and sharing designs
- **Multi-format Support**: Import GenBank, FASTA files and convert them to SBOL
- **Smart Sequence Analysis**: Automatic detection of genetic parts using SYNBICT libraries
- **Feature Libraries**: Access curated part libraries from various SynBioHub collections
- **Rich Text Editing**: Enhanced description editing with annotation highlighting

### How to Use SeqImprove

#### Step 1: Load Your Design
- **Upload File**: Drag & drop or select SBOL, GenBank, or FASTA files
- **From URL**: Load directly from a SynBioHub URL
- **Start from Scratch**: Create a new design using the blank template
- **Try Example**: Use the test file to explore features

#### Step 2: Add Sequence Annotations
- Select feature libraries from the dropdown (Cello, Free Genes, etc.)
- Click "Load Sequence Annotations" to get automatic suggestions
- Review and enable/disable suggested annotations
- Annotations show up as colored highlights on your sequence

#### Step 3: Enhance Text Descriptions  
- Click "Load Text Annotations" for NLP-based suggestions
- Add rich descriptions with automatic ontology linking
- Highlighted terms link to relevant biological concepts

#### Step 4: Add Metadata
- **Roles & Types**: Specify the biological function (promoter, CDS, etc.)
- **Target Organisms**: Add organisms where this design would function
- **Proteins**: Link to relevant protein databases
- **References**: Add citations and literature references

#### Step 5: Export or Upload
- **Download**: Export as SBOL XML file for local use
- **Upload to SynBioHub**: Connect to your SynBioHub instance and upload directly
- Choose between creating new collections or adding to existing ones

### Supported File Formats
- **SBOL2 XML** (.xml, .sbol) - Primary format, full feature support
- **GenBank** (.gb, .gbk) - Converted to SBOL with feature preservation
- **FASTA** (.fa, .fasta) - Sequence-only, converted to basic SBOL

### Working with SynBioHub
SeqImprove integrates with any SynBioHub instance:
1. Click the SynBioHub login button
2. Enter your SynBioHub instance URL (e.g., `https://charmme.synbiohub.org`)
3. Provide your credentials
4. Upload designs directly from the curation interface

**Supported SynBioHub Operations:**
- Browse root collections
- Upload to new or existing collections  
- Preserve metadata
- Handle authentication tokens securely

## For Developers

### Architecture Overview
SeqImprove is a **monorepo** built with:
- **Frontend**: React + Vite + Zustand (state management) + Mantine UI
- **Backend**: Python Flask API with Docker containerization  
- **Build System**: Turborepo for monorepo management
- **Key Libraries**: SBOL2GraphView (SBOL parsing), SYNBICT (sequence annotation)

### Key Components

#### Frontend Structure (`apps/web/src/`)
```
components/
├── CurationForm.jsx         # Main curation interface
├── UploadForm.jsx           # File upload and initial setup
├── SequenceSection.jsx      # Sequence visualization & annotation
├── TextSection.jsx          # Text annotation interface  
├── SequenceHighlighter.jsx  # Visual sequence display
└── ...                      # Other UI components

modules/
├── store.js                 # Zustand state management
├── api.js                   # Backend API calls
├── sbol.js                  # SBOL document manipulation
└── util.js                  # Helper functions
```

#### Backend Structure (`apps/server/`)
```
app.py                       # Main Flask application
assets/synbict/              # Feature libraries for annotation
├── feature-libraries/       # SBOL collections for part matching
requirements.txt             # Python dependencies
Dockerfile                   # Container configuration
```

### Backend

There are 8 API routes, the least obvious of which is

    @app.get("/api/boot")
    def boot_app():
        return "Rise and shine"

This endpoint gets queried as soon as someone visits the SeqImprove website. The purpose of this is to trigger the invocation of the `setup` function. Flask will call `setup()` when your API gets its first request. We use the `setup` function to load the feature libraries that SynBict uses for annotating DNA sequences, which is a time consuming operation.

When running SeqImprove locally, the `setup` function will run once and never again, or at least not until you restart the backend. But in a cloud computing environment, the backend server will shut down when it is not in use. So we ensure that `setup` runs as soon as someone visits the website so that annotating sequences will go much faster, as the user won't have to wait for the `setup` to finish, as it will have a head start.

The sequence annotations are taken care of by [SYNBICT](https://github.com/SD2E/SYNBICT), which internally uses the [flashtext](https://github.com/vi3k6i5/flashtext) python library for string matching.


<a id="org3b2d932"></a>

### API Reference

#### Core Endpoints
- `GET /api/boot` - Initialize server and load feature libraries
- `POST /api/annotateSequence` - Get sequence annotations using SYNBICT
- `POST /api/annotateText` - Get text annotations using BioBERT NLP
- `POST /api/convert/genbanktosbol2` - Convert GenBank to SBOL
- `POST /api/cleanSBOL` - Clean and normalize SBOL URIs
- `POST /api/findSimilarParts` - Find similar parts in databases
- `POST /api/importUserLibrary` - Import custom feature libraries from SynBioHub
- `POST /api/deleteUserLibrary` - Remove custom feature libraries

#### Request/Response Examples
```javascript
// Sequence Annotation
POST /api/annotateSequence
{
  "completeSbolContent": "<sbol xml>",  
  "partLibraries": ["cello_library.xml"],
  "cleanDocument": true
}

// Text Annotation  
POST /api/annotateText
{
  "text": "This promoter regulates gene expression"
}
```

### State Management
SeqImprove uses **Zustand** for state management with key stores:

```javascript
// Main store structure
{
  document: SBOL2GraphView,          // Parsed SBOL document
  sequenceAnnotations: Array,        // Sequence annotations
  textAnnotations: Array,            // Text annotations  
  synBioHubUrlPrefix: String,        // Current SynBioHub instance
  isLoggedInToSomeSynBioHub: Boolean // Authentication state
}
```

### Adding New Features

#### 1. Adding New File Format Support
```javascript
// In store.js, extend loadSBOL function
case FILE_TYPES.NEW_FORMAT:
    showErrorNotification("New Format Error", 
        "Custom error message for new format");
    break;
```

#### 2. Adding New API Endpoints
```python
# In app.py
@app.post("/api/newEndpoint")
def new_endpoint():
    data = request.get_json()
    # Process data
    return {"result": "success"}
```

#### 3. Adding New UI Components
```jsx
// Create component in components/
import { useStore } from '../modules/store'

export default function NewComponent() {
    const someData = useStore(s => s.someData)
    return <div>{/* Component JSX */}</div>
}
```

### Testing
- **Backend**: Use pytest for API endpoint testing
- **Frontend**: Use browser dev tools and manual testing
- **Integration**: Test SBOL import/export workflows end-to-end

<a id="org3c0aa94"></a>
