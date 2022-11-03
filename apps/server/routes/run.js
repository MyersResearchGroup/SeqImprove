import chalk from "chalk"
import { generateLink } from "../modules/util.js"


export default function run(app) {
    app.post("/run", async (req, res) => {

        console.log(chalk.gray("\nReceived run request."))

        // @param complete_sbol,  -  The single-use URL for the complete SBOL of the object
        // @param shallow_sbol,   -  The single-use URL for a truncated SBOL file of the the object
        // @param genbank,        -  The single-use URL for the Genbank of the object (Note: This will
        //                              lead to a blank website for all RDF-types other than Component)
        // @param top_level,      -  The top-level URL of the SBOL object
        // @param instanceUrl,    -  The top-level URL of the SynBioHub instance
        // @param size,           -  The number of RDF triples about an object
        // @param type,           -  The RDF type of the top-level object
        // @param submit_link,    -  the SynBioHub link to which the HTML form should submit
        // @param eval_params,    -  A dictionary providing the output values from the evaluate form

        // respond
        res.status(200).send({
            needs_interface: true,
            own_interface: true,
            interface: generateLink(req.body),
        })
    })
}