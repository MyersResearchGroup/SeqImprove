import { findSimilarParts } from "../../modules/similar.js"


export default function similarParts(app) {
    app.post("/api/findSimilarParts", async (req, res) => {

        const { topLevelUri } = req.body

        // find similar parts
        console.log(chalk.gray("Finding similar parts..."))
        const similarParts = await findSimilarParts(topLevelUri)
        console.log(chalk.gray("Found ") + chalk.green(similarParts.length) + chalk.gray(" similar parts:"))
        console.log(chalk.green(similarParts.map(part => part.name).join(", ")))

        res.send({
            similarParts
        })
    })
}