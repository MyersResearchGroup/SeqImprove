import { useState, useEffect, forwardRef, createElement } from "react"
import { useForceUpdate } from "@mantine/hooks"
import { Box, Checkbox, CloseButton, Flex, Grid, NumberInput, SegmentedControl, Select, Title } from '@mantine/core';
import { Button, Center, Group, Stack, Loader, Modal, NavLink, Space, CopyButton, ActionIcon, Tooltip, Textarea, MultiSelect, Text, Highlight} from "@mantine/core"
import { FiDownloadCloud } from "react-icons/fi"
import { FaCheck, FaPencilAlt, FaPlus, FaTimes, FaArrowRight, FaInfoCircle, FaTrash } from "react-icons/fa"
import { mutateDocument, mutateSequencePartLibrariesSelected, useAsyncLoader, useStore } from "../modules/store"
import AnnotationCheckbox from "./AnnotationCheckbox"
import FormSection from "./FormSection"
import SequenceHighlighter from "./SequenceHighlighter"
import { Copy, Check } from "tabler-icons-react"
import { showErrorNotification, showNotificationSuccess } from "../modules/util"
import "../../src/sequence-edit.css"
import { HighlightWithinTextarea } from 'react-highlight-within-textarea'
import { openConfirmModal, openContextModal } from "@mantine/modals"
import { SynBioHubClientLogin } from "./CurationForm";
import { importLibrary, checkLibraryCache } from "../modules/api";

const WORDSIZE = 8;

// Issue #158: the DNA identity threshold starts at its ceiling and the user may
// only relax it downward. Kept in sync with SYNBICT's own default (pid_threshold)
// so the CLI and the web app agree on what an unconfigured run does.
const DEFAULT_DNA_IDENTITY = 95;

// Issue #208. Shortest library feature that may be annotated. SYNBICT splits the
// search at 14 bp: aligners handle >=14, an exhaustive substring search handles
// 9-13, and below 9 a motif is too short to be specific -- hence the floor.
// The default sits on that floor so nothing the annotator can find is excluded
// by default; raise it to cut short-part noise.
const DEFAULT_MIN_FEATURE_LENGTH = 9;
const MIN_FEATURE_LENGTH_FLOOR = 9;

function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

function Copier({ anno, sequence }) {
    const selectionStart = anno.location[0];
    const selectionLength = anno.location[1] - selectionStart;
    const selection = Array.from(sequence).splice(selectionStart, selectionLength).join('');

    return (
        <CopyButton value={selection} timeout={2000}>
            {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow position="right">
                    <ActionIcon color={copied ? 'teal' : 'gray'} onClick={copy}>
                        {copied ? <Check size="1rem" /> : <Copy size="1rem" />}
                    </ActionIcon>
                </Tooltip>
            )}
        </CopyButton>
  );
}

function insertSpaces(wordSize, sequence) {
    const regex = new RegExp(".{1," + String(wordSize) + "}", "g");
    const matchData = sequence.match(regex);
    return matchData ? sequence.match(regex).join(' ') : sequence;
}

function isValid(sequence) {
    if (sequence.match(/^[actguryswkmbdhvnacdefghiklmnpqrstvwy.-\s]+$/i) === null) { // contains invalid char
        const message = "SeqImprove only accepts DNA sequences with no ambiguities. Please submit a sequence with only ACTG bases.";
        const found = sequence.match(/[^actguryswkmbdhvnacdefghiklmnpqrstvwy.-\s]+/i);
        const start = found.index;
        const end = start + found[0].length;
        return [start, end, message];
    }
    return [null, null, null];
}

function reformat(sequenceText) {
    // return insertSpaces(WORDSIZE, sequenceText.replace(/\s/g, ''));
    return sequenceText;
}

function Sequence({ colors }) {

    const sequence = useStore(s => s.document?.root.sequence);

    const annotations = useStore(s => s.sequenceAnnotations);
    useStore(s => s.document?.root.sequenceAnnotations);    // force rerender from document change

    const { isActive, setActive } = useStore(s => s.sequenceAnnotationActions);

    // sequence editing state
    // const description = useStore(s => s.document?.root.richDescription)
    // const richDescriptionBuffer = useStore(s => s.richDescriptionBuffer)
    // const [workingDescription, setWorkingDescription] = useState(false)
    const [workingSequence, setWorkingSequence] = useState(false);

    const handleStartSequenceEdit = () => {
        // put spaces in text based on WORDSIZE ? or should I do this? yes, it would be nice, but not required        
        setWorkingSequence(insertSpaces(WORDSIZE, sequence.toLowerCase()));
    };

    const forceUpdate = useForceUpdate();
    useEffect(() => {
        forceUpdate();
    }, [annotations]);

    const handleEndSequenceEdit = (discard = false) => {
        const [start, end, err]= isValid(workingSequence); // index
  
        if (discard) {
            setWorkingSequence(false);
            return;
        } else {
            if (err) {
                showErrorNotification(err);
                // highlight the errors
                console.log("start: ", start);
                console.log("end: ", end);
                return;
            }  
        }

        setWorkingSequence(false);

        // propagate buffer changes to sequence
        mutateDocument(useStore.setState, state => {
            state.document.root.sequence = workingSequence.replace(/\s/g, '');
            state.sequenceAnnotations.forEach(anno => {
                if (isActive(anno.id)) {
                    setActive(anno.id);
                }
                state.sequenceAnnotationActions.removeAnnotation(anno.id);
            });

            state.sequenceAnnotations = [];
        });
    }

    const handleChange = (event) => {
        setWorkingSequence(event);
    };

    function myBlockStyleFn(contentBlock) {
        return 'superFancyBlockquote';
      }

    return (
        <FormSection
            key="Sequence"
            title="Sequence"
            rightSection={
                workingSequence !== false ? //TODO:if not false, a string, empty strings 
                    <Group spacing={6}>
                        <ActionIcon onClick={() => handleEndSequenceEdit(true)} color="red"><FaTimes /></ActionIcon>
                        <ActionIcon onClick={() => handleEndSequenceEdit(false)} color="green"><FaCheck /></ActionIcon>
                    </Group> :
                    <ActionIcon onClick={handleStartSequenceEdit}><FaPencilAlt /></ActionIcon>
            }
            style={{ maxWidth: "800px" }}
        >
            {workingSequence !== false ? 
                <HighlightWithinTextarea
                    value={workingSequence}
                    highlight={{
                        highlight: /[^actguryswkmbdhvnacdefghiklmnpqrstvwy.-\s]/gi,
                        className: 'red',
                    }}
                    onChange={handleChange}
                    blockStyleFn={myBlockStyleFn}
                />
                : sequence && // TODO: add feature in SequenceHiglighter
                    <SequenceHighlighter 
                    sequence={sequence.toLowerCase()}
                    annotations={annotations.map((anno, i) => ({
                        ...anno,
                        color: colors[i],
                        active: isActive(anno.id) ?? false,
                    }))}
                    onChange={setActive}
                    isActive={isActive}
                    wordSize={WORDSIZE}
                    />
            }      
        </FormSection>
    )
}

function MyAnnotationCheckbox({ title, color, active, onChange, featureLibrary }) {
    const [isVisible, setIsVisible] = useState(false);
    
    return <div className="my-anno-checkbox-container"
                onMouseEnter={() => setIsVisible(true)}
                onMouseLeave={() => setIsVisible(false)}                
           >
               <input type="checkbox"
                      id={title}
                      name={title}
                      className="my-checkbox"
                      style={{accentColor: color}}
                      checked={active ? "checked" : ""}
                      onChange={onChange}
               />
               <label for={title} style={{color: color}}>
                   {title}
               </label>
               {(!isVisible) &&
                <span class="material-symbols-outlined">
                    info
                </span>
               }
               {isVisible && <div className="tooltip">{featureLibrary}</div>}
           </div>
}

function MyToolTip({ featureLibrary }) {    
    return isValidUrl(featureLibrary) ? (<a href={featureLibrary} target="_blank" className="tooltip_link"> 
         <span className="tooltip"
                 data-text={featureLibrary}
           >
               info
        </span> 
    </a>
    ) : (
        <span className="tooltip" data-text={featureLibrary}>
            info
        </span>
    );   
}

function Annotations({ colors }) {

    const annotations = useStore(s => s.sequenceAnnotations)
    const [loadSequenceAnnotations, loading] = useAsyncLoader("SequenceAnnotations");
    useStore(s => s.document?.root?.sequenceAnnotations);    // force rerender from document change
    const loadSBOL = useStore(s => s.loadSBOL);
    const clearSequenceAnnotations = useStore(s => s.clearSequenceAnnotations)

    const { isActive, setActive } = useStore(s => s.sequenceAnnotationActions)
    const sequence = useStore(s => s.document?.root.sequence)?.toLowerCase()

    const libraryImported = useStore(s => s.libraryImported)
    const isLoggedInToSynBioHub = useStore(s => s.isLoggedInToSomeSynBioHub);
    const [ isInteractingWithSynBioHub, setIsInteractingWithSynBioHub ] = useState(false);
    const [ isImportingLibrary, setIsImportingLibrary ] = useState(false);
    const [ synBioHubs, setSynBioHubs ] = useState([]);
    const [ cachedLibraryUrls, setCachedLibraryUrls ] = useState([]);
    const addCachedUrl = (url) => setCachedLibraryUrls(prev => [...prev, url]);

    useStore(s => s.libraryImported);

    const loadSynBioHubs = async () => {
        const response = await fetch("https://wor.synbiohub.org/instances");
        const registries = await response.json();
        if (localStorage.getItem("synBioHubs")) setSynBioHubs(JSON.parse(localStorage.getItem("synBioHubs")))
        else setSynBioHubs(registries.map(r => r.uriPrefix));
    };
    
    const sequencePartLibraries = [
        { value: 'local_libraries', label: 'SeqImprove Local Libraries'},
        { value: 'CnDatabase_collection.xml', label: 'Cryptococcus neoformans Database'},
        { value: 'Eco1C1G1T1_collection.xml', label: 'Cello E. Coli Parts Collection'},
    ];

    const localLibraries = [
        { value: 'Anderson_Promoters_Anderson_Lab_collection.xml', label: 'Anderson Promoters Anderson Lab Collection' },
        { value: 'CIDAR_MoClo_Extension_Kit_Volume_I_Murray_Lab_collection.xml', label: 'CIDAR MoCLO Extension Kit Volume I Murray Lab Collection' },
        { value: 'CIDAR_MoClo_Toolkit_Densmore_Lab_collection.xml', label: 'CIDAR MoClo Toolkit Freemont Lab Collection' },
        { value: 'Itaconic_Acid_Pathway_Voigt_Lab_collection.xml', label: 'Itaconic Acid Pathway Voigt Lab Collection' },
        { value: 'MoClo_Yeast_Toolkit_Dueber_Lab_collection.xml', label: 'MoClo Yeast Toolkit Dueber Lab Colletion' },
        { value: 'Natural_and_Synthetic_Terminators_Voigt_Lab_collection.xml', label: 'Natural and Synthetic Terminators Voigt Lab Collection' },
        { value: 'Pichia_MoClo_Toolkit_Lu_Lab_collection.xml', label: 'Pichia MoClo Toolkit Lu Lab Collection' },
        { value: 'cello_library.xml', label: 'Cello Library' },
    ];

    const [sequencePartLibrariesSelected, setSequencePartLibrariesSelected] = useState([]);
    const importedLibraries = useStore(s => s.importedLibraries)
    const toggleLibrary = useStore(s => s.toggleImportedLibraries)
    const removeLibrary = useStore(s => s.removeImportedLibrary)

    // Algorithm and match mode state
    const [selectedAlgorithm, setSelectedAlgorithm] = useState('BLASTN');
    const [similarDNAMatches, setSimilarDNAMatches] = useState(false);
    const [allowSimilarMatches, setAllowSimilarMatches] = useState(false);
    const [codonMatches, setCodonMatches] = useState(false);
    const [includeHypothetical, setIncludeHypothetical] = useState(false);
    const [isCircular, setIsCircular] = useState(false);
    // Minimum coverage-weighted DNA identity for a hit to be kept. Only consulted
    // when similar (non-exact) DNA matching is on -- an exact match is 100% by
    // definition. Starts at the ceiling; the user can only relax it downward.
    const [dnaIdentity, setDnaIdentity] = useState(DEFAULT_DNA_IDENTITY);
    // Non-maximum suppression: drop a hit that substantially overlaps a
    // higher-scoring one, so one locus collapses to its single best reference.
    // Off by default, matching SYNBICT -- NMS discards nested parts, which suits
    // circuit reconstruction but not exhaustive annotation.
    const [applyNms, setApplyNms] = useState(false);
    const [minFeatureLength, setMinFeatureLength] = useState(DEFAULT_MIN_FEATURE_LENGTH);


    const AnnotationCheckboxContainer = forwardRef((props, ref) => (
        <div ref={ref} {...props}>
            <AnnotationCheckbox  {...props} />
        </div>
    ));

    const handleAnalyzeSequenceClick = () => {
        const libs = importedLibraries.filter((lib) => lib.enabled == true)
        const allLibraries = [...sequencePartLibrariesSelected, ...libs]
        if (allLibraries.length === 0) {
            showErrorNotification('No libraries selected', 'Select one or more libraries to continue')
            return
        }
        // notCached is the list of remote SynBioHub libraries that still need to be fetched from the network
        const notCached = libs.filter(lib =>
            lib.value.includes('synbiohub.org') && !cachedLibraryUrls.includes(lib.value)
        )
        if (notCached.length > 0) {
            const names = notCached.map(l => l.label).join(', ')
            showErrorNotification('Library not imported', `"${names}" is not cached on the server. Please import it using the SynBioHub button before analyzing.`)
            return
        }
        loadSequenceAnnotations(libs, selectedAlgorithm, similarDNAMatches, allowSimilarMatches, codonMatches, includeHypothetical, isCircular, dnaIdentity, applyNms, minFeatureLength)
    }

    const handleClose = (library) => {removeLibrary(library)};

    // Removes only what an analysis run produced. Annotations that came with the
    // uploaded file (GenBank features, which reference no Component) are left
    // alone -- uncheck those individually to keep them out of the export.
    const runAnnotationCount = annotations.filter(anno => anno.isPart).length;
    const fileAnnotationCount = annotations.length - runAnnotationCount;
    const handleClearAnnotationsClick = () => openConfirmModal({
        title: "Clear annotations from analysis?",
        children: (
            <Text size="sm">
                This removes the {runAnnotationCount} annotation{runAnnotationCount == 1 ? "" : "s"} found
                by analysis.
                {fileAnnotationCount > 0 &&
                 ` The ${fileAnnotationCount} annotation${fileAnnotationCount == 1 ? "" : "s"} that came with your file ` +
                 `${fileAnnotationCount == 1 ? "is" : "are"} kept — uncheck ${fileAnnotationCount == 1 ? "it" : "them"} to leave ${fileAnnotationCount == 1 ? "it" : "them"} out of the export.`}
            </Text>
        ),
        labels: { confirm: "Clear", cancel: "Cancel" },
        onCancel: () => { },
        onConfirm: clearSequenceAnnotations,
        confirmProps: { color: "red" },
        centered: true,
    });

    // FlashText does not support the alignment-based match options below
    // (similar/codon/protein matching, circular). Disable and reset them when
    // it is selected so stale values are never sent to the backend.
    const isFlashText = selectedAlgorithm === 'FlashText';
    // The identity threshold and NMS reach the aligner-based mappers, which
    // FlashText (a literal keyword matcher) does not use.
    const supportsAlignmentTuning = !isFlashText;

    const handleAlgorithmChange = (value) => {
        setSelectedAlgorithm(value);
        if (value === 'FlashText') {
            setSimilarDNAMatches(false);
            setCodonMatches(false);
            setAllowSimilarMatches(false);
            setIncludeHypothetical(false);
            setIsCircular(false);
        }
    };

    // Part annotations (Components) are listed above bare sequence features
    // (SequenceFeatures). The original index is carried along because `colors`
    // is indexed by position in `annotations` -- reordering the display must not
    // change which color an annotation gets, or the list and the sequence
    // highlighter would disagree.
    const indexedAnnotations = annotations.map((anno, i) => ({ anno, i }));
    const partAnnotations = indexedAnnotations.filter(({ anno }) => anno.isPart);
    const featureAnnotations = indexedAnnotations.filter(({ anno }) => !anno.isPart);

    const renderAnnotation = ({ anno, i }) => (
        <Group spacing="xs" sx={{ flexGrow: 1, }} key={anno.name + '_' + i}>
            <AnnotationCheckbox
                title={anno.name}
                color={colors[i]}
                active={isActive(anno.id) ? 1 : 0}
                onChange={val => setActive(anno.id, val)}
            />

            {anno.featureLibrary &&
             <MyToolTip
                featureLibrary={ anno.featureLibrary.endsWith('.xml')
                    ? anno.featureLibrary.replace(/_/g, ' ').slice(0, -4)
                    : anno.featureLibrary}
             >
             </MyToolTip>}

            <Copier anno={anno} sequence={sequence} />
        </Group>
    );

    return (
        <FormSection title="Sequence Annotations" key="Sequence Annotations">
            {/* Headings only appear once there is something in both groups --
                with a single group the labels are just noise. */}
            {partAnnotations.length > 0 && featureAnnotations.length > 0 &&
             <Text size="xs" color="dimmed" weight={600} mb={4}>Part Annotations</Text>}
            {partAnnotations.map(renderAnnotation)}

            {partAnnotations.length > 0 && featureAnnotations.length > 0 &&
             <Text size="xs" color="dimmed" weight={600} mt={10} mb={4}>Sequence Annotations</Text>}
            {featureAnnotations.map(renderAnnotation)}

            <Select
                label="Algorithm"
                placeholder="Select algorithm"
                value={selectedAlgorithm}
                onChange={handleAlgorithmChange}
                data={[
                    { value: 'FlashText', label: 'FlashText' },
                    { value: 'BWA', label: 'BWA' },
                    { value: 'Minimap2', label: 'Minimap2' },
                    { value: 'BLASTN', label: 'BLASTN' }
                ]}
            />

            <Group mt="sm" spacing="xs">
                <NumberInput
                    label="Minimum Feature Length (bp)"
                    value={minFeatureLength}
                    onChange={value => setMinFeatureLength(value ?? DEFAULT_MIN_FEATURE_LENGTH)}
                    min={MIN_FEATURE_LENGTH_FLOOR}
                    step={1}
                    precision={0}
                    sx={{ width: 120 }}
                />
                <Tooltip
                    label="Library parts shorter than this are not annotated. Lower it to pick up short parts such as RBSs and terminators; raise it to cut noise. Applies to every algorithm."
                    position="right"
                    withArrow
                    multiline
                    width={250}
                >
                    <ActionIcon size="xs" variant="transparent" color="gray">
                        <FaInfoCircle size={14} />
                    </ActionIcon>
                </Tooltip>
            </Group>

            <Group mt="sm" spacing="xs">
                <Checkbox
                    label="Similar DNA Sequence Matches"
                    checked={similarDNAMatches}
                    disabled={isFlashText}
                    onChange={(event) => setSimilarDNAMatches(event.currentTarget.checked)}
                />
                <Tooltip
                    label="Allow DNA-level matches with 95%+ sequence identity instead of requiring exact DNA matches (applies to BWA, Minimap2, BLASTN)"
                    position="right"
                    withArrow
                    multiline
                    width={250}
                >
                    <ActionIcon size="xs" variant="transparent" color="gray">
                        <FaInfoCircle size={14} />
                    </ActionIcon>
                </Tooltip>
            </Group>

            {/* Both reach every alignment-based mapper (BWA, Minimap2, BLASTN).
                FlashText matches literal keywords and has no notion of either. */}
            <Group mt="sm" spacing="xs">
                <NumberInput
                    label="DNA Identity (%)"
                    value={dnaIdentity}
                    onChange={value => setDnaIdentity(value ?? DEFAULT_DNA_IDENTITY)}
                    min={0}
                    max={DEFAULT_DNA_IDENTITY}
                    step={1}
                    precision={0}
                    disabled={!supportsAlignmentTuning || !similarDNAMatches}
                    sx={{ width: 120 }}
                />
                <Tooltip
                    label="Minimum coverage-weighted identity (identical bases / reference length) for a match to be kept. Starts at 95% and can only be lowered. Requires similar DNA matching — an exact match is 100% by definition."
                    position="right"
                    withArrow
                    multiline
                    width={250}
                >
                    <ActionIcon size="xs" variant="transparent" color="gray">
                        <FaInfoCircle size={14} />
                    </ActionIcon>
                </Tooltip>
            </Group>

            <Group mt="sm" spacing="xs">
                <Checkbox
                    label="NMS"
                    checked={applyNms}
                    disabled={!supportsAlignmentTuning}
                    onChange={(event) => setApplyNms(event.currentTarget.checked)}
                />
                <Tooltip
                    label="Non-maximum suppression: when several parts match the same locus, keep only the highest-scoring one instead of reporting nested/overlapping duplicates."
                    position="right"
                    withArrow
                    multiline
                    width={250}
                >
                    <ActionIcon size="xs" variant="transparent" color="gray">
                        <FaInfoCircle size={14} />
                    </ActionIcon>
                </Tooltip>
            </Group>

            <Group mt="sm" spacing="xs">
                <Checkbox
                    label="Codon Matches"
                    checked={codonMatches}
                    disabled={isFlashText}
                    onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setCodonMatches(checked);
                        if (!checked) {
                            setAllowSimilarMatches(false);
                            setIncludeHypothetical(false);
                        }
                    }}
                />
                <Tooltip
                    label="Enable codon-aware matching that accounts for synonymous codons coding for the same amino acid"
                    position="right"
                    withArrow
                    multiline
                    width={250}
                >
                    <ActionIcon size="xs" variant="transparent" color="gray">
                        <FaInfoCircle size={14} />
                    </ActionIcon>
                </Tooltip>
            </Group>

            <Group mt="sm" spacing="xs">
                <Checkbox
                    label="Similar Protein Matches"
                    checked={allowSimilarMatches}
                    disabled={isFlashText || !codonMatches}
                    onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setAllowSimilarMatches(checked);
                        if (!checked) setIncludeHypothetical(false);
                    }}
                />
                <Tooltip
                    label="Allow protein-level matches with 95%+ identity instead of requiring exact protein matches (Prokka)"
                    position="right"
                    withArrow
                    multiline
                    width={250}
                >
                    <ActionIcon size="xs" variant="transparent" color="gray">
                        <FaInfoCircle size={14} />
                    </ActionIcon>
                </Tooltip>
            </Group>

            <Group mt="sm" spacing="xs">
                <Checkbox
                    label="Include Hypothetical"
                    checked={includeHypothetical}
                    disabled={isFlashText || !allowSimilarMatches}
                    onChange={(event) => setIncludeHypothetical(event.currentTarget.checked)}
                />
                <Tooltip
                    label="Include features labeled as hypothetical or uncharacterized in the annotation results"
                    position="right"
                    withArrow
                    multiline
                    width={250}
                >
                    <ActionIcon size="xs" variant="transparent" color="gray">
                        <FaInfoCircle size={14} />
                    </ActionIcon>
                </Tooltip>
            </Group>

            <Group mt="sm" spacing="xs">
                <Checkbox
                    label="Circular sequence"
                    checked={isCircular}
                    disabled={isFlashText}
                    onChange={(event) => setIsCircular(event.currentTarget.checked)}
                />
                <Tooltip
                    label="Treat the target as a circular plasmid so features spanning the origin are detected (applies to BWA, Minimap2, BLASTN)"
                    position="right"
                    withArrow
                    multiline
                    width={250}
                >
                    <ActionIcon size="xs" variant="transparent" color="gray">
                        <FaInfoCircle size={14} />
                    </ActionIcon>
                </Tooltip>
            </Group>

            <MultiSelect
                mt="sm"
                data={sequencePartLibraries}
                label="Sequence part libraries"
                placeholder="Choose the libraries to annotate against"
                value={sequencePartLibrariesSelected}
                searchable
                maxSelectedValues={3} // <-- NOTE: There is a bug on deployment where the backend doesn't respond when many part libraries are selected. We're not able to reproduce it locally, but this makes it a non issue.
                onChange={((...librariesSelected) => {
                    const chosenLibraries = sequencePartLibraries.filter(lib => {
                        return librariesSelected[0].includes(lib.value);
                    });
                    // mutate the libraries Selected in the store
                    mutateSequencePartLibrariesSelected(useStore.setState, state => {
                        if(chosenLibraries.some(item => item.value === 'local_libraries')) {
                            state.sequencePartLibrariesSelected = chosenLibraries.filter(item => item.value !== 'local_libraries')
                            state.sequencePartLibrariesSelected.push(...localLibraries)
                        }
                        else state.sequencePartLibrariesSelected = chosenLibraries;
                    });


                    setSequencePartLibrariesSelected(...librariesSelected);
                })}
            />

            {libraryImported && <Stack mt="sm" gap="xs">
                {importedLibraries.map((library, index) => (
                    <Grid key={index}>
                        <Grid.Col span={10}>
                            <Checkbox
                                label={library.label}
                                checked={library.enabled}
                                onChange={() => toggleLibrary(index)}
                                key={index}
                            />
                        </Grid.Col>
                        <Grid.Col span={2}>
                            <Tooltip label="Delete from server memory">
                                <CloseButton
                                    onClick={() => handleClose(library)}
                                />
                            </Tooltip>
                        </Grid.Col>
                    </Grid>
                ))}
                </Stack>
            }

            <NavLink
                label="Import Library"
                icon={<FaPlus />}
                variant="subtle"
                active={true}
                color="blue"
                onClick={() => {
                    loadSynBioHubs();
                    setIsInteractingWithSynBioHub(true);
                }}
                sx={{ borderRadius: 6 }}
            />

            <SynBioHubClient
                opened={isInteractingWithSynBioHub}
                setIsInteractingWithSynBioHub={setIsInteractingWithSynBioHub}
                onClose={() => setIsInteractingWithSynBioHub(false)}
                setOpened={setIsInteractingWithSynBioHub}
                synBioHubs={synBioHubs}
                setIsImportingLibrary={setIsImportingLibrary}
                addCachedUrl={addCachedUrl}
            />
            
            {loading ?
                <Center>
                    <Loader my={30} size="sm" variant="dots" /> :
                </Center>
             : <NavLink
                    label={isImportingLibrary ? "Importing library, please wait..." : "Analyze Sequence"}
                    icon={isImportingLibrary ? <Loader size="xs" /> : <FiDownloadCloud />}
                    variant="subtle"
                    active={true}
                    color={isImportingLibrary ? "gray" : "blue"}
                    disabled={isImportingLibrary}
                    onClick={handleAnalyzeSequenceClick}
                    sx={{ borderRadius: 6 }}
               />
            }

            {runAnnotationCount > 0 && !loading &&
             <NavLink
                 label="Clear Annotations"
                 icon={<FaTrash />}
                 variant="subtle"
                 color="red"
                 onClick={handleClearAnnotationsClick}
                 sx={{ borderRadius: 6 }}
             />
            }
        </FormSection>
    )
}

function SynBioHubClient({opened, onClose, setIsInteractingWithSynBioHub, synBioHubs, setIsImportingLibrary, addCachedUrl}) {
    const isLoggedInToSynBioHub = useStore(s => s.isLoggedInToSomeSynBioHub);

    return (
        <Modal
            title="SynBioHub"
            opened={opened}
            onClose={onClose}
            size={"auto"}
        >
            {isLoggedInToSynBioHub ?
             <SynBioHubClientSelect setIsInteractingWithSynBioHub={setIsInteractingWithSynBioHub} setIsImportingLibrary={setIsImportingLibrary} addCachedUrl={addCachedUrl}/> :
             <SynBioHubClientLogin synBioHubs={synBioHubs} />
            }
        </Modal>
    );
}

function SynBioHubClientSelect({ setIsInteractingWithSynBioHub, setIsImportingLibrary, addCachedUrl }) {        
    const synBioHubUrlPrefix = useStore(s => s.synBioHubUrlPrefix);
    const [ synBioHubSessionToken, _ ] = useState(sessionStorage.getItem('SynBioHubSessionToken'));   
    const [inputError, setInputError] = useState(false);
    const [ isLoading, setIsLoading ] = useState(false);
    const libraryImported = useStore(s => s.libraryImported);
    const [ id, setID ] = useState("collection_id");
    const [ rootCollectionsLoaded, setRootCollectionsLoaded ] = useState(false);
    const [ rootCollectionsIDs, setRootCollectionsIDs ] = useState([]);
    const [ rootCollections, setRootCollections ] = useState([]);
    const [ rootCollectionURI, setRootCollectionURI ] = useState('');
    const [ selectedCollectionID, selectCollectionID ] = useState('');

    const xml = useStore(s => s.serializeXML());        

    (async () => {        
        if (!rootCollectionsLoaded) { // curl -X GET -H "Accept: text/plain" -H "X-authorization: 5ab3af6e-2ddd-4ac2-af76-d4285d2ffe03" https://synbiohub.org/rootCollections
            console.log(synBioHubSessionToken);
            const response2 = await fetch(synBioHubUrlPrefix + "/rootCollections", {                
                method: "GET",
                headers: {
                    "Accept": "text/plain",
                    "X-authorization": synBioHubSessionToken,
                },
            });            

            const _rootCollections = await response2.json();
            
            // SynBioHub URIs use the canonical domain (e.g. synbiohub.org) even when the API
            // is accessed via api.synbiohub.org, so strip the api. subdomain before filtering.
            const uriPrefix = synBioHubUrlPrefix.replace(/^(https?:\/\/)api\./, '$1');
            let regex = RegExp(uriPrefix.replace(/^https?/, 'https?') + "/(?:user|public)/.*");
            const userRootCollections = _rootCollections.filter(collection => collection.uri.match(regex));
            setRootCollections(userRootCollections);
            setRootCollectionsIDs(userRootCollections.map(collection => collection.displayId));
            setRootCollectionsLoaded(true);
        }           
    })();

    const [ inputErrorID, setInputErrorID ] = useState(false);
    const importedLibraries = useStore(s => s.importedLibraries)
    const addLibrary = useStore(s => s.addImportedLibrary)

    return (                        
        <Group>
            <Title order={3}>Download from SynBioHub</Title>
            <Group>
                 <Group>
                     {!rootCollectionsLoaded ?
                      <Center>
                          <Loader my={30} size="sm" variant="dots" />
                      </Center> :
                      <Select
                          label="Root Collection"
                          placeholder="Pick one"
                          data={rootCollectionsIDs}                      
                          onChange={(v) => {                          
                                setRootCollectionURI(rootCollections.find(collection => collection.displayId == v).uri)
                                selectCollectionID(v)
                          }}
                          searchable
                      />
                     }

                     {isLoading ? 
                      <Center>
                          <Loader my={30} size="sm" variant="dots" />
                      </Center> :
                      <Button onClick={async () => {
                            setIsLoading(true);
                            setIsImportingLibrary(true);

                            const alreadyCached = await checkLibraryCache(rootCollectionURI);
                            if (alreadyCached) {
                                setIsInteractingWithSynBioHub(false);
                                setIsImportingLibrary(false);
                                addCachedUrl(rootCollectionURI);
                                mutateDocument(useStore.setState, state => {state.libraryImported = true});
                                addLibrary({ value: rootCollectionURI, label: selectedCollectionID, enabled: false});
                                showNotificationSuccess("Library Ready!", selectedCollectionID + " is already cached. Enable the checkbox next to it and click 'Analyze Sequence' to annotate.");
                                return;
                            }

                            const response = await importLibrary(synBioHubSessionToken, rootCollectionURI)

                            setIsInteractingWithSynBioHub(false);
                            setIsImportingLibrary(false);
                            if (response && response.success) {
                                setInputError(false);
                                addCachedUrl(response.cachedUrl);
                                showNotificationSuccess("Library Ready!", selectedCollectionID + " is cached. Enable the checkbox next to it and click 'Analyze Sequence' to annotate.");
                                mutateDocument(useStore.setState, state => {state.libraryImported = true});
                                addLibrary({ value: rootCollectionURI, label: selectedCollectionID, enabled: false})
                            } else {
                                showErrorNotification("Import Failed", "Could not import library from SynBioHub. The server may be unreachable or your session may have expired. Try logging in again.");
                            }
                        }}>
                          Submit
                      </Button>
                     }
                 </Group>          
            </Group>
        </Group> 
    )
}

export default {
    Sequence, Annotations
}
