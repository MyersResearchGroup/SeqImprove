import { useState, useEffect, forwardRef, createElement } from "react"
import { useForceUpdate } from "@mantine/hooks"
import { Checkbox } from '@mantine/core';
import { Button, Center, Group, Loader, NavLink, Space, CopyButton, ActionIcon, Tooltip, Textarea, MultiSelect, Text, Highlight} from "@mantine/core"
import { FiDownloadCloud } from "react-icons/fi"
import { FaCheck, FaPencilAlt, FaPlus, FaTimes, FaArrowRight } from "react-icons/fa"
import { mutateDocument, mutateSequencePartLibrariesSelected, useAsyncLoader, useStore } from "../modules/store"
import AnnotationCheckbox from "./AnnotationCheckbox"
import FormSection from "./FormSection"
import SequenceHighlighter from "./SequenceHighlighter"
import { Copy, Check } from "tabler-icons-react"
import { showErrorNotification } from '../modules/util'
import "../../src/sequence-edit.css"
import { HighlightWithinTextarea } from 'react-highlight-within-textarea'

const WORDSIZE = 8;

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
            {workingSequence !== false ? //TextArea is the editor // TODO: add highlight in TextArea
                // <Textarea
                //     size="md"
                //     minRows={20}
                //     value={workingSequence}
                //     onChange={event => {
                //         const textArea = event.currentTarget;
                //         const start = textArea.selectionStart;
                //         const end = textArea.selectionEnd;
                //         // isValid?nothing : update the state
                //         console.log("isInValid: ", start);
                //         setWorkingSequence(textArea.value);  //value is the value of ACTG, reformat is adding spaces, call validate function                      
                //     }}
                //     styles={{ input: { font: "14px monospace", lineHeight: "1.5em", error: true } }}
                // /> 
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

    const { isActive, setActive } = useStore(s => s.sequenceAnnotationActions)
    const sequence = useStore(s => s.document?.root.sequence)?.toLowerCase()
    
    const sequencePartLibraries = [
        { value: 'local_libraries', label: 'SeqImprove Local Libraries'},
        { value: 'https://synbiohub.org/public/CnDatabase/CnDatabase_collection/1', label: 'Cryptococcus neoformans Database'},
        { value: 'https://synbiohub.org/public/free_genes_feature_libraries/free_genes_feature_libraries_collection/1', label: 'Free Genes Feature Libraries'},
        { value: 'https://synbiohub.org/public/iGEM_2016_interlab/iGEM_2016_interlab_collection/1', label: 'Devices from the iGEM 2016 interlab'},
        { value: 'https://synbiohub.org/public/Digitalizer/Digitalizer_collection/1', label: 'Digitizer Library'},
        { value: 'https://synbiohub.org/public/Excel2SBOL/Excel2SBOL_collection/1', label: 'Excel2SBOL Collection'},
        { value: 'https://synbiohub.org/public/sbksactivities/sbksactivities_collection/1', label: 'SBKS Activities Collection'},
        { value: 'https://synbiohub.org/public/SEGA/SEGA_collection/1', label: 'SEGA Collecition'},
        { value: 'https://synbiohub.org/public/Intein_assisted_Bisection_Mapping/Intein_assisted_Bisection_Mapping_collection/1', label: 'Intein Assisted Bisection Mapping Collection'},
        { value: 'https://synbiohub.org/public/Eco1C1G1T1/Eco1C1G1T1_collection/1', label: 'Cello E. Coli Parts Collection'},
        { value: 'https://synbiohub.org/public/SBOLCompliantSoftware/SBOLCompliantSoftware_collection/1', label: 'SBOL Compliant Software Collection'},
    ];

    const localLibraries = [         
        { value: 'Anderson_Promoters_Anderson_Lab_collection.xml', label: 'Anderson Promoters Anderson Lab Collection' },
        { value: 'CIDAR_MoClo_Extension_Kit_Volume_I_Murray_Lab_collection.xml', label: 'CIDAR MoCLO Extension Kit Volume I Murray Lab Collection' },
        { value: 'CIDAR_MoClo_Toolkit_Densmore_Lab_collection.xml', label: 'CIDAR MoClo Toolkit Freemont Lab Collection' },
        { value: 'EcoFlex_MoClo_Toolkit_Freemont_Lab_collection.xml', label: 'EcoFlex Moclo Toolkit Freemont Lab Collection' },
        { value: 'Itaconic_Acid_Pathway_Voigt_Lab_collection.xml', label: 'Itaconic Acid Pathway Voigt Lab Collection' },
        { value: 'MoClo_Yeast_Toolkit_Dueber_Lab_collection.xml', label: 'MoClo Yeast Toolkit Dueber Lab Colletion' },
        { value: 'Natural_and_Synthetic_Terminators_Voigt_Lab_collection.xml', label: 'Natural and Synthetic Terminators Voigt Lab Collection' },
        { value: 'Pichia_MoClo_Toolkit_Lu_Lab_collection.xml', label: 'Pichia MoClo Toolkit Lu Lab Collection' },
        { value: 'cello_library.xml', label: 'Cello Library' },
    ];

    const [sequencePartLibrariesSelected, setSequencePartLibrariesSelected] = useState([]);
    const isChecked = useStore((state) => state.isChecked);
    const toggleCleanCheckbox = useStore((state) => state.toggleChecked);
    const fromSynBioHub = useStore(s => s.fromSynBioHub)


    const AnnotationCheckboxContainer = forwardRef((props, ref) => (
        <div ref={ref} {...props}>
            <AnnotationCheckbox  {...props} />
        </div>
    ));

    const handleAnalyzeSequenceClick = () => {
        if (sequencePartLibrariesSelected.length > 0) loadSequenceAnnotations()
        else showErrorNotification('No libraries selected ', 'Select one or more libraries to continue')
    }

    return (
        <FormSection title="Sequence Annotations" key="Sequence Annotations">
            {annotations.map((anno, i) =>
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
            )}

            <MultiSelect
                data={sequencePartLibraries}
                label="Sequence part libraries"
                placeholder="Choose the libraries to annotate against"
                value={sequencePartLibrariesSelected}
                searchable
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
            { fromSynBioHub &&
                <Checkbox label="Clean SynBioHub URIs" checked={isChecked} onChange={toggleCleanCheckbox} style={{ margin: '10px 10px 5px 5px' }}/>
            }

            {loading ?
                <Center>
                    <Loader my={30} size="sm" variant="dots" /> :
                </Center>
             : <NavLink
                    label="Analyze Sequence"
                    icon={<FiDownloadCloud />}
                    variant="subtle"
                    active={true}
                    color="blue"
                    onClick={handleAnalyzeSequenceClick}
                    sx={{ borderRadius: 6 }}
               />
            }
        </FormSection>
    )
}


export default {
    Sequence, Annotations
}
