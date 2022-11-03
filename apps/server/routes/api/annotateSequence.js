import fetch from "node-fetch"
import fs from "fs/promises"
import path from "path"
import os from "os"
import chalk from "chalk"

import { findNewAnnotations } from "../../modules/util.js"
import { runSynbict } from "../../modules/synbict/index.js"

// need this for windows
process.env.ComSpec = "powershell"

export default function synbict(app) {
    app.post("/api/synbict", async (req, res) => {

        const { completeSbolContent } = req.body

        // create temp directory
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "curation-"))
        const originalFile = path.join(tempDir, "original.xml")
        const annotatedFile = path.join(tempDir, "annotated.xml")

        console.log(chalk.gray("Working in ") + chalk.yellow(tempDir))

        // write original SBOL to file
        await fs.writeFile(originalFile, completeSbolContent)

        // read in all feature libraries -- SYNBICT says they support
        // directories, but they actually don't; only lists of files
        const featureLibrariesDir = "./feature-libraries"
        const featureLibraries = (await fs.readdir(featureLibrariesDir))
            .map(libraryFileName => path.join(featureLibrariesDir, libraryFileName))

        console.log(chalk.gray("Running SYNBICT..."))

        // Run SYNBICT
        try {
            await runSynbict(originalFile, annotatedFile, featureLibraries)
        }
        catch (err) {
            console.error(err)
            res.status(500).send({ message: "Server encountered an error running SYNBICT." })
            return
        }

        console.log(chalk.gray("SYNBICT has completed."))

        // find new annotations from synbict annotated doc
        const synbictAnnotations = await findNewAnnotations(
            completeSbolContent,
            await fs.readFile(annotatedFile, "utf8")
        )

        console.log(chalk.gray("Found ") + chalk.green(synbictAnnotations.length) + chalk.gray(" potential annotations:"))
        console.log(chalk.green(synbictAnnotations.map(a => a.name).join(", ")))

        res.send({
            annotations: synbictAnnotations
        })
    })
}