import { Box, Button, Center, FileInput, Group, LoadingOverlay, NativeSelect, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { MdOutlineFileUpload } from 'react-icons/md'
import { useStore } from '../modules/store'
import { showErrorNotification, showWarningNotification, validDisplayID } from '../modules/util'
import { fetchConvertGenbankToSBOL2 } from '../modules/api'
import { FILE_TYPES } from '../modules/fileTypes'
import { HOMESPACE } from '../modules/homespace'
// import { Graph, S2ComponentDefinition, SBOL2GraphView, genbankToSBOL2 } from "sbolgraph"

// Escape the five XML predefined entities so header text with &, <, >, " or '
// can't produce invalid SBOL when interpolated into the template below.
function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function parseFasta(fastaContent) {
    // Normalize line endings (handles \n, \r\n, and bare \r) so a Windows FASTA
    // doesn't leave stray \r on the header or embedded in the sequence.
    const lines = fastaContent.split(/\r\n|\r|\n/);
    // The header is the first non-blank line and must start with '>'.
    const headerIndex = lines.findIndex(l => l.trim() !== '');
    const headerLine = headerIndex >= 0 ? lines[headerIndex].trim() : '';
    if (headerLine[0] !== '>') {
        return [{ displayId: null, description: null, sequence: null }, "Invalid fasta file, expected '>' on line 1", []];
    }
    // Header (minus '>'): first whitespace-delimited token is the id, the
    // remainder is the description.
    const [ first, ...rest ] = headerLine.slice(1).trim().split(/\s+/);
    const firstWord = first ?? '';
    if (!firstWord) {
        return [{ displayId: null, description: null, sequence: null }, "Invalid fasta file, header has no identifier", []];
    }
    const description = rest.join(' ');
    // convert first word to sbol compliant displayId
    const displayId = (firstWord[0].match(/[a-z_]/i) ? firstWord[0] : '_') + firstWord.slice(1).replace(/\W/g, '_');
    // Sequence = every line after the header up to the next record ('>'),
    // stripped of all whitespace so blank lines / wrapping don't corrupt it.
    const bodyLines = lines.slice(headerIndex + 1);
    const nextRecordIndex = bodyLines.findIndex(line => line[0] === '>');
    const sequenceLines = nextRecordIndex < 0 ? bodyLines : bodyLines.slice(0, nextRecordIndex);
    const sequence = sequenceLines.join('').replace(/\s/g, '');

    // Warnings never block the upload, they just tell the user what we did.
    const warnings = [];
    // SeqImprove models a single component, so a multi-record FASTA can only
    // contribute its first record — say so instead of dropping the rest silently.
    if (nextRecordIndex >= 0) {
        const ignored = bodyLines.slice(nextRecordIndex).filter(line => line[0] === '>').length;
        warnings.push(`This FASTA contains ${ignored + 1} records. Only the first ("${firstWord}") was imported; the other ${ignored} ${ignored === 1 ? 'was' : 'were'} ignored.`);
    }
    // currently is blocking the upload when include invalid chars
    // only show the warning without blocking the uploading
    if (sequence.match(/^[actguryswkmbdhvnacdefghiklmnpqrstvwy.-]+$/i) === null) {
        warnings.push("Sequence includes invalid characters.");
    }
    return [{ displayId, description, sequence }, null, warnings]
}

// Builds a minimal SBOL2 document. Used both by the FASTA import and by "From
// Scratch". `description` and `sequence` are empty for a from-scratch plasmid,
// and no dcterms:title is written unless a name is supplied -- a new document
// must not arrive with placeholder values the user has to delete.
function compileSBOL({ displayId, name = '', description = '', sequence = '' }) {
    const title = name ? `\n    <dcterms:title>${escapeXml(name)}</dcterms:title>` : '';
    return `<?xml version="1.0" ?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:igem="http://wiki.synbiohub.org/wiki/Terms/igem#" xmlns:sbh="http://wiki.synbiohub.org/wiki/Terms/synbiohub#" xmlns:sbol="http://sbols.org/v2#" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:gbconv="http://sbols.org/genBankConversion#" xmlns:genbank="http://www.ncbi.nlm.nih.gov/genbank#" xmlns:prov="http://www.w3.org/ns/prov#" xmlns:om="http://www.ontology-of-units-of-measure.org/resource/om-2/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <sbol:ComponentDefinition rdf:about="${HOMESPACE}/${displayId}/1">
    <sbol:persistentIdentity rdf:resource="${HOMESPACE}/${displayId}"/>
    <sbol:displayId>${displayId}</sbol:displayId>
    <sbol:version>1</sbol:version>${title}
    <dcterms:description>${escapeXml(description)}</dcterms:description>
    <sbol:type rdf:resource="http://www.biopax.org/release/biopax-level3.owl#DnaRegion"/>
    <sbol:sequence rdf:resource="${HOMESPACE}/${displayId}_Sequence/1"/>
  </sbol:ComponentDefinition>
  <sbol:Sequence rdf:about="${HOMESPACE}/${displayId}_Sequence/1">
    <sbol:persistentIdentity rdf:resource="${HOMESPACE}/${displayId}_Sequence"/>
    <sbol:displayId>${displayId}</sbol:displayId>
    <sbol:version>1</sbol:version>
    <sbol:elements>${escapeXml(sequence)}</sbol:elements>
    <sbol:encoding rdf:resource="http://www.chem.qmul.ac.uk/iubmb/misc/naseq.html"/>
  </sbol:Sequence>
</rdf:RDF>`
}

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 8000 } = options;
    
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(resource, {
        ...options,
        signal: controller.signal 
    });
    clearTimeout(id);
    
    return response;
}

export default function UploadForm() {

    const loadSBOL = useStore(s => s.loadSBOL);
    const docLoading = useStore(s => s.loadingSBOL);
    
    const form = useForm({
        initialValues: {
            method: Methods.Upload,
            url: "",
            file: null,
            file_t: "SBOL2",
            displayId: "",
            name: "",
        },
        validate: {
            url: (value, values) => {
                if (values.method != Methods.URL)
                    return false
                // attempt to form URL with value
                try {
                    new URL(value)
                    return false
                }
                catch (err) { }
                return true
            },
            file: (value, values) => values.method == Methods.Upload && !value,
            // The displayId is fixed at creation time and can't be changed
            // afterwards, so it has to be valid before the document exists.
            displayId: (value, values) => {
                if (values.method != Methods.FromScratch)
                    return null
                if (!value?.trim())
                    return "A display ID is required"
                if (!validDisplayID(value.trim()))
                    return "Letters, digits and underscores only, and it can't start with a digit"
                return null
            },
        }
    });

    const methodForms = {
        [Methods.Upload]: <>
                              <FileInput
                                  placeholder="Click to upload a file"
                                  radius="xl"
                                  icon={<MdOutlineFileUpload />}
                                  {...form.getInputProps("file")}
                              />
                              <NativeSelect
                                  label="Input Format"                                  
                                  data={['SBOL2', 'FASTA', 'GenBank']}
                                  {...form.getInputProps("file_t")}
                              />
                          </>,
        [Methods.URL]: <>
                           <TextInput
                               placeholder="Enter an SBOL URL"
                               {...form.getInputProps("url")}
                           />
                       </>,
        [Methods.FromScratch]: <>
                                   <TextInput
                                       label="Display ID"
                                       description="Identifies the plasmid — permanent, it can't be changed later. Letters, digits and underscores only; it can't start with a digit."
                                       placeholder="e.g. SrpR_RBS_S3_gate"
                                       {...form.getInputProps("displayId")}
                                   />
                                   <TextInput
                                       label="Name"
                                       description="A readable name for the plasmid. Spaces are fine here. Optional — you can add or change it later on the Text page."
                                       placeholder="e.g. SrpR RBS S3 gate"
                                       {...form.getInputProps("name")}
                                   />
                               </>,
    };

    const handleSubmit = async values => {        
        switch (values.method) {
        case Methods.Upload:
            // validate file content matches selected type
            const fileContent = await values.file.text();
            const fileContentTrimmed = fileContent.trim();
            
            switch (values.file_t) {
            case "SBOL2":
                // check if it's actually SBOL (should be XML starting with <?xml)
                if (!fileContentTrimmed.startsWith('<?xml') && !fileContentTrimmed.startsWith('<rdf:RDF')) {
                    // check if it might be GenBank format
                    if (fileContentTrimmed.includes('LOCUS') || fileContentTrimmed.includes('ORIGIN')) {
                        showErrorNotification("File Type Mismatch", [
                            "The uploaded file appears to be GenBank format, but SBOL2 was selected.",
                            "Please either:",
                            "• Select 'GenBank' as the input format, or",
                            "• Upload an SBOL2 (.xml) file instead"
                        ]);
                        return;
                    }
                    // check if it might be FASTA format  
                    if (fileContentTrimmed.startsWith('>')) {
                        showErrorNotification("File Type Mismatch", [
                            "The uploaded file appears to be FASTA format, but SBOL2 was selected.",
                            "Please either:",
                            "• Select 'FASTA' as the input format, or", 
                            "• Upload an SBOL2 (.xml) file instead"
                        ]);
                        return;
                    }
                }
                loadSBOL(fileContent, FILE_TYPES.SBOL2);
                break;
            case "FASTA":
                // check if it's actually FASTA format
                if (!fileContentTrimmed.startsWith('>')) {
                    // check if it might be SBOL format
                    if (fileContentTrimmed.startsWith('<?xml') || fileContentTrimmed.startsWith('<rdf:RDF')) {
                        showErrorNotification("File Type Mismatch", [
                            "The uploaded file appears to be SBOL2 format, but FASTA was selected.",
                            "Please either:",
                            "• Select 'SBOL2' as the input format, or",
                            "• Upload a FASTA (.fasta/.fa) file instead"
                        ]);
                        return;
                    }
                    // check if it might be GenBank format
                    if (fileContentTrimmed.includes('LOCUS') || fileContentTrimmed.includes('ORIGIN')) {
                        showErrorNotification("File Type Mismatch", [
                            "The uploaded file appears to be GenBank format, but FASTA was selected.",
                            "Please either:",
                            "• Select 'GenBank' as the input format, or",
                            "• Upload a FASTA (.fasta/.fa) file instead"
                        ]);
                        return;
                    }
                }
                const [ fastaDoc, err, warnings ] = parseFasta(fileContent);
                if (err) {
                    showErrorNotification(err);
                    return;
                }
                warnings.forEach(warning => showWarningNotification(warning));
                const sbolContent = compileSBOL(fastaDoc);
                loadSBOL(sbolContent, FILE_TYPES.FASTA);
                break;
            case "GenBank":
                // check if it's actually GenBank format
                if (!fileContentTrimmed.includes('LOCUS') && !fileContentTrimmed.includes('ORIGIN')) {
                    // check if it might be SBOL format
                    if (fileContentTrimmed.startsWith('<?xml') || fileContentTrimmed.startsWith('<rdf:RDF')) {
                        showErrorNotification("File Type Mismatch", [
                            "The uploaded file appears to be SBOL2 format, but GenBank was selected.",
                            "Please either:",
                            "• Select 'SBOL2' as the input format, or",
                            "• Upload a GenBank (.gb/.gbk) file instead"
                        ]);
                        return;
                    }
                    // check if it might be FASTA format
                    if (fileContentTrimmed.startsWith('>')) {
                        showErrorNotification("File Type Mismatch", [
                            "The uploaded file appears to be FASTA format, but GenBank was selected.",
                            "Please either:",
                            "• Select 'FASTA' as the input format, or",
                            "• Upload a GenBank (.gb/.gbk) file instead"
                        ]);
                        return;
                    }
                }
                const genbank_text = fileContent;                
                // The API returns `err`, not `err1`. Destructuring the wrong name
                // made this branch unreachable: every failed conversion fell into
                // the success path and called loadSBOL("") instead, so the user
                // saw a generic parse error while the SBOL validator's actual
                // complaint was discarded.
                // (named convertErr because `err` is already taken by the FASTA
                // branch -- switch cases share one block scope)
                const { err: convertErr, sbol2_content } = await fetchConvertGenbankToSBOL2(genbank_text);
                if (convertErr) {
                    console.error(convertErr);
                    switch (convertErr) {
                    case TypeError:
                        showErrorNotification("There was a problem processing your GenBank file. It may not be valid.");
                        break;
                    case "Network Error":
                        showErrorNotification("Network Error. It could be that our servers are down. Check your internet connection.");
                        break;
                    case "Parse Error":
                        showErrorNotification("There was a problem processing your GenBank file. This could be an internal server error.");
                        break;
                    default:
                        // Anything else is the converter's own message -- show it,
                        // it names the feature or field that could not convert.
                        showErrorNotification("GenBank conversion failed", String(convertErr));
                    }
                    return;
                }
                if (!sbol2_content) {
                    showErrorNotification("GenBank conversion failed",
                                          "The converter returned an empty document.");
                    return;
                }
                loadSBOL(sbol2_content, FILE_TYPES.GENBANK);
                break;
            }
                                  
            break;
        case Methods.URL:
            const url = values.url.match(/\/sbol$/) ? values.url : 
                values.url.match(/\/$/) ?     values.url + 'sbol' : 
                values.url + '/sbol';
            loadSBOL(url);
            break;
        case Methods.FromScratch:
            // Built from the display ID entered above rather than loaded from a
            // fixture, so the new document has no placeholder name/description.
            loadSBOL(compileSBOL({
                displayId: values.displayId.trim(),
                name: values.name.trim(),
            }), FILE_TYPES.FROM_SCRATCH);
            break;
        default:
            break;
        }
    };

    const useTestFile = () => {
        loadSBOL(window.location.origin + "/Test_Part.xml");
    };

    return (
        <>
            <Center sx={{ height: "90vh" }}>
                <Box>
                    <Text align="center">Welcome to</Text>
                    <Title align="center" mb={30}>SeqImprove</Title>
                    <form onSubmit={form.onSubmit(handleSubmit)}>
                        <Stack w={400}>
                            <SegmentedControl data={Object.values(Methods)} {...form.getInputProps("method")} />
                            {methodForms[form.values.method]}
                            <Group mt={20} position="center">
                                {form.values.method == "From Scratch" ?
                                 undefined :
                                 <Button variant="outline" onClick={useTestFile}>Try with a test file!</Button>                                    
                                }
                                <Button type="submit">Submit</Button>
                            </Group>
                        </Stack>
                    </form>                    
                </Box>
            </Center>
            <LoadingOverlay visible={docLoading} />
        </>
    );
}

const Methods = {
    Upload: "Upload a file",
    URL: "URL",
    FromScratch: "From Scratch",
}
