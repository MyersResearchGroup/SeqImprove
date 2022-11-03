import express from "express"
import morgan from "morgan"
import chalk from 'chalk'
import "dotenv"

import evaluate from "./routes/evaluate.js"
import run from "./routes/run.js"
import status from "./routes/status.js"

import annotateSequence from "./routes/api/annotateSequence.js"
import annotateText from "./routes/api/annotateText.js"
import findSimilarParts from "./routes/api/findSimilarParts.js"


// create server
const PORT = 5000
const app = express()

// setup middleware
app.use(morgan('tiny'))
app.use(express.json())
app.use(express.text())


// serve static files for frontend
// app.use(express.static("dist/client"))

// serve static files for ontologies
// app.use(express.static('public'))


// SynBioHub Plugin Endpoints

// GET  /status
status(app)
// POST /evaluate
evaluate(app)
// POST /run
run(app)


// API Endpoints

annotateSequence(app)
annotateText(app)
findSimilarParts(app)


app.listen(PORT, () => {
    console.log(
        chalk.bgWhite.blue(`\nExpress listening on port ${PORT}\n`)
    )
})