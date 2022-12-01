import chalk from "chalk"
import { runBiobert } from "../../modules/biobert.js"
import { pullFreeText } from "../../modules/util.js"


export default function annotateText(app) {
    app.post("/api/annotateText", async (req, res) => {

        const { text: freeText } = req.body

        console.log(chalk.gray("Running BioBert BERN2..."))
        
        // do biobert annotation on free text
        const biobertResult = await runBiobert(freeText)
        
        console.log(chalk.gray("BioBert BERN2 has completed."))
        console.log(chalk.gray("Found ") + chalk.green(biobertResult.length) + chalk.gray(" potential annotations:"))
        console.log(chalk.green(biobertResult.map(a => a.mentions[0].text).join(", ")))


        res.send({
            text: freeText,
            annotations: biobertResult,
        })
    })
}