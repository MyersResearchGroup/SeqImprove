import { Box, Button, Center, FileInput, Group, LoadingOverlay, NativeSelect, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { MdOutlineFileUpload } from 'react-icons/md'
import { useStore } from '../modules/store'
import { showErrorNotification, showWarningNotification } from '../modules/util'
import { fetchConvertGenbankToSBOL2 } from '../modules/api'
import { FILE_TYPES } from '../modules/fileTypes'
// import { Graph, S2ComponentDefinition, SBOL2GraphView, genbankToSBOL2 } from "sbolgraph"

function parseFasta(fastaContent) {
    // split sequence from description line
    const [ descriptionLine, ...sequenceLines ] = fastaContent.split('\n');
    // grab first "word" from description line
    const [ first, ...rest ] = descriptionLine.split(' ');
    if (first[0] !== '>') {
        return [{ displayId: null, description: null, sequence: null }, "Invalid fasta file, expected '>' on line 1", null];
    }
    const firstWord = first.slice(1);
    const description = rest.join(' ');
    // convert first word to sbol compliant displayId
    const displayId = (firstWord[0].match(/[a-z_]/i) ? firstWord[0] : '_') + firstWord.slice(1).replace(/\W/g, '_');
    // join and validate sequence
    const sequence = sequenceLines.join('');
    // currently is blocking the upload when include invalid chars
    // only show the warning without blocking the uploading
    if (sequence.match(/^[actguryswkmbdhvnacdefghiklmnpqrstvwy.-]+$/i) === null) {
        //show warning
        return [{ displayId, description, sequence }, null, "Sequence includes invalid characters."]
    }
    return [{ displayId, description, sequence }, null, null]
}

function compileFastaToSBOL({ displayId, description, sequence }) {
    return `<?xml version="1.0" ?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:igem="http://wiki.synbiohub.org/wiki/Terms/igem#" xmlns:sbh="http://wiki.synbiohub.org/wiki/Terms/synbiohub#" xmlns:sbol="http://sbols.org/v2#" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:gbconv="http://sbols.org/genBankConversion#" xmlns:genbank="http://www.ncbi.nlm.nih.gov/genbank#" xmlns:prov="http://www.w3.org/ns/prov#" xmlns:om="http://www.ontology-of-units-of-measure.org/resource/om-2/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <sbol:ComponentDefinition rdf:about="https://seqimprove.synbiohub.org/${displayId}/1">
    <sbol:persistentIdentity rdf:resource="https://seqimprove.synbiohub.org/${displayId}"/>
    <sbol:displayId>${displayId}</sbol:displayId>
    <sbol:version>1</sbol:version>
    <dcterms:title>${displayId}</dcterms:title>    
    <dcterms:description>${description}</dcterms:description>
    <sbol:type rdf:resource="http://www.biopax.org/release/biopax-level3.owl#DnaRegion"/>
    <sbol:sequence rdf:resource="https://seqimprove.synbiohub.org/${displayId}_Sequence/1"/>
  </sbol:ComponentDefinition>
  <sbol:Sequence rdf:about="https://seqimprove.synbiohub.org/${displayId}_Sequence/1">
    <sbol:persistentIdentity rdf:resource="https://seqimprove.synbiohub.org/${displayId}_Sequence"/>
    <sbol:displayId>${displayId}</sbol:displayId>
    <sbol:version>1</sbol:version>
    <sbol:elements>${sequence}</sbol:elements>
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
    };

    const handleSubmit = async values => {        
        switch (values.method) {
        case Methods.Upload:

            switch (values.file_t) {
            case "SBOL2":
                loadSBOL(await values.file.text(), FILE_TYPES.SBOL2);
                break;
            case "FASTA":
                const [ fastaDoc, err, warning ] = parseFasta(await values.file.text());
                if (err) {
                    showErrorNotification(err);
                    return;
                }
                if (warning) {
                    showWarningNotification(warning);
                }               
                const sbolContent = compileFastaToSBOL(fastaDoc);
                loadSBOL(sbolContent, FILE_TYPES.FASTA);
                break;
            case "GenBank":
                const genbank_text = await values.file.text();                
                const { sbol2_content, err1 } = await fetchConvertGenbankToSBOL2(genbank_text);
                if (!err1) {
                    loadSBOL(sbol2_content, FILE_TYPES.GENBANK);    
                } else {
                    console.error(err1);
                    switch (err1) {
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
                        showErrorNotification("There was a problem processing your GenBank file.");
                    }                 
                }
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
            loadSBOL(window.location.origin + "/From_Scratch.xml");
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
