import { Box, Button, Center, FileInput, Group, LoadingOverlay, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { MdOutlineFileUpload } from 'react-icons/md'
import { useStore } from '../modules/store'
import { showErrorNotification } from '../modules/util'

function fileNameExtension(fileName) {
    let matchData;
    if (matchData = fileName.match(/\.[^.]+$/)) {
        return matchData[0];
    }

    return '';
}

function parseFasta(fastaContent) {
    // split sequence from description line
    const [ descriptionLine, ...sequenceLines ] = fastaContent.split('\n');
    // grab first "word" from description line
    const [ first, ...rest ] = descriptionLine.split(' ');
    if (first[0] !== '>') {
        return [{ displayId: null, description: null, sequence: null }, "Invalid fasta file, expected '>' on line 1"];
    }
    const firstWord = first.slice(1);
    const description = rest.join(' ');
    // convert first word to sbol compliant displayId
    const displayId = (firstWord[0].match(/[a-z_]/i) ? firstWord[0] : '_') + firstWord.slice(1).replace(/\W/g, '_');
    // join and validate sequence
    const sequence = sequenceLines.join('');
    if (sequence.match(/^[actg]+$/i) === null) {
        return [{ displayId: null, description: null, sequence: null }, "SeqImprove only accepts DNA sequences with no ambiguities. Please submit a sequence with only ACTG bases."];
    }
    return [{ displayId, description, sequence }, null]
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

export default function UploadForm() {

    const loadSBOL = useStore(s => s.loadSBOL);
    const docLoading = useStore(s => s.loadingSBOL);
    
    const form = useForm({
        initialValues: {
            method: Methods.Upload,
            url: "",
            file: null,
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
            const ext = fileNameExtension(values.file.name)
            
            if (ext == '.fasta' ||
                ext == '.fa' ||
                ext == '.fna' ||
                ext == '.ffn' ||
                ext == '.frn') {

                // fastaDoc = { displayId, description, sequence }
                const [ fastaDoc, err ] = parseFasta(await values.file.text());
                if (err) {
                    showErrorNotification(err);
                    return;
                }                
                const sbolContent = compileFastaToSBOL(fastaDoc);
                loadSBOL(sbolContent);                
            } else if (ext == '.faa') {
                showErrorNotification("SeqImprove only accepts DNA sequences with no ambiguities. Please submit a sequence with only ACTG bases.");                
            } else {
                // assume sbol document
                loadSBOL(await values.file.text());
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
