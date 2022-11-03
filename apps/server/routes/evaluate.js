
const AcceptedTypes = ["Component", "Sequence", "ComponentDefinition"]

export default function evaluate(app) {
    app.post("/evaluate", (req, res) => {

        // extract valid params from body
        const {
            complete_sbol,  // The single-use URL for the complete SBOL of the object
            shallow_sbol,   // The single-use URL for a truncated SBOL file of the the object
            genbank,        // The single-use URL for the Genbank of the object (Note: This will
            //                      lead to a blank website for all RDF-types other than Component)
            top_level,      // The top-level URL of the SBOL object
            instanceUrl,    // The top-level URL of the SynBioHub instance
            size,           // The number of RDF triples about an object
            type,           // The RDF type of the top-level object
            submit_link,    // the SynBioHub link to which the HTML form should submit
        } = req.body

        // see if type is supported
        if (!AcceptedTypes.includes(type)) {
            res.status(418).send({ 
                message: "Supported types include: " + AcceptedTypes.join(", "), 
                typeSent: type, 
            })
            return
        }

        // otherwise, respond that we don't need an interface yet
        res.status(200).send({ needs_interface: false })
    })
}