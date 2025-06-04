import fs from "fs/promises"
import { Graph, SBOL2GraphView } from "sbolgraph"

const FilePathAnnotated = process.argv[2];
const FilePathOriginal = process.argv[3];

(async () => {
    const sbolContentAnnotated = await fs.readFile(FilePathAnnotated, "utf8");
    const sbolContentOriginal = await fs.readFile(FilePathOriginal, "utf8");

    // create and load original doc
    const originalDoc = new SBOL2GraphView(new Graph());
    await originalDoc.loadString(sbolContentOriginal);

    // create and load annotated doc
    const annDoc = new SBOL2GraphView(new Graph());
    await annDoc.loadString(sbolContentAnnotated);

    // make a list of persistentIds to avoid
    const originalAnnotations = originalDoc.rootComponentDefinitions[0].sequenceAnnotations
          .map(sa => sa.persistentIdentity);

    // make a list of new annotations
    console.log(JSON.stringify(annDoc.rootComponentDefinitions[0].sequenceAnnotations
    // filter annotations already in original document
        .filter(sa => !originalAnnotations.includes(sa.persistentIdentity))
    // just return the info we need
        .map(sa => ({
            name: sa.displayName,
            id: sa.persistentIdentity,
            location: [sa.rangeMin - 1, sa.rangeMax], // convert to 0 based indexing to match javascript array indices
        }))));
})();

