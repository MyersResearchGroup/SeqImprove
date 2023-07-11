import { Container, Title, Tabs, Text, Space, LoadingOverlay, Button, Group, Header, List, ActionIcon, Tooltip, Textarea } from '@mantine/core'
import { useStore, mutateDocument } from '../modules/store'
import { useCyclicalColors } from "../hooks/misc"
import SimilarParts from './SimilarParts'
import RoleSelection from "./RoleSelection"
import ProteinSelection from './ProteinSelection'
import SplitPanel from "./SplitPanel"
import TargetOrganismsSelection from './TargetOrganismsSelection'
import SuggestedProteins from './SuggestedProteins'
import SequenceSection from './SequenceSection'
import TextSection from './TextSection'
import { ModalsProvider } from '@mantine/modals'
import TextAnnotationModal from './TextAnnotationModal'
import { TbDownload } from "react-icons/tb"
import ReactMarkdown from 'react-markdown'
import References from './References'
import { FaHome, FaPencilAlt, FaTimes, FaCheck } from 'react-icons/fa'
import { useState } from "react"
import { showErrorNotification } from "../modules/util"

function validDisplayID(displayID) {
    return displayID.match(/^[a-z_]\w+$/i);
}

export default function CurationForm({ }) {
    
    const displayId = useStore(s => s.document?.root.displayId)
    const richDescription = useStore(s => s.document?.root.richDescription)

    // colors for annotations
    const sequenceColors = useCyclicalColors(useStore(s => s.sequenceAnnotations.length))
    const textColors = useCyclicalColors(useStore(s => s.textAnnotations.length))

    // exporting
    const exportDocument = useStore(s => s.exportDocument)


    // show notification with known bugs
    // useEffect(() => {
    //     showNotification({
    //         title: "Known problems & bugs",
    //         message: <>
    //             <Text>Here's a list of known problems & bugs that will be fixed. Please take note of any others.</Text>
    //             <List size="sm" ml="xs"  >
    //                 <List.Item><Text color="dimmed">Missing references section</Text></List.Item>
    //             </List>
    //         </>,
    //         autoClose: false,
    //     })
    // }, [])

    const [ isEditingDisplayID, setIsEditingDisplayID ] = useState(false);
    const [ workingDisplayID, setWorkingDisplayID ] = useState(displayId);

    const handleStartDisplayIDEdit = _ => {
        setIsEditingDisplayID(true);
        setWorkingDisplayID(displayId);
    };

    const handleEndDisplayIDEdit = (cancelled = false) => {
        if (cancelled) {
            setIsEditingDisplayID(false);
            return;
        }
        
        if (!validDisplayID(workingDisplayID)) {
            showErrorNotification("DisplayID should contain only alphanumeric characters and underscores. The first character cannot be a number.");
            return;
        }
        
        setIsEditingDisplayID(false);       

        mutateDocument(useStore.setState, state => {
            // updateChildURIDisplayIDs(workingDisplayID, state.document.root.displayId, state.document);
            
            // Replace displayId in URIs in xml            
            let remainingXML = state.document.serializeXML();
            let xmlChunks = [];
            let matchData = remainingXML.match(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/);

            while (matchData) {
                xmlChunks.push(remainingXML.slice(0,matchData.index));                
                const uri = matchData[0];
                const regexp = new RegExp(state.document.root.displayId, 'g');
                xmlChunks.push(uri.replace(regexp, workingDisplayID));
               
                remainingXML = remainingXML.slice(matchData.index + uri.length);                
                matchData = remainingXML.match(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/);
            }
            
            // Replace displayId property in xml
            remainingXML = xmlChunks.concat(remainingXML).join('');                      
            xmlChunks = [];
            const regexpOpenTag = /\<sbol\:displayId\>/;
            const regexpCloseTag = /\<\/sbol\:displayId\>/;
            matchData = remainingXML.match(regexpOpenTag);            

            while(matchData) {
                xmlChunks.push(remainingXML.slice(0, matchData.index + matchData[0].length));
                remainingXML = remainingXML.slice(matchData.index + matchData[0].length);

                matchData = remainingXML.match(regexpCloseTag);
                xmlChunks.push(workingDisplayID);
                
                remainingXML = remainingXML.slice(remainingXML.match(regexpCloseTag).index);
                matchData = remainingXML.match(regexpOpenTag);
            }
                                    
            const newSBOLcontent = xmlChunks.concat(remainingXML).join('');

            state.loadSBOL(newSBOLcontent);            
        });
    };

    return (
        <Tabs defaultValue="overview" variant="pills" styles={tabStyles}>
            <Header p="lg">
                <Container>
                    <Group position="apart" align="flex-end">
                        <Group spacing={40} ml={-80}>
                            <Tooltip label="Return Home">
                                <ActionIcon component="a" href="/" size="xl">
                                    <FaHome />
                                </ActionIcon>
                            </Tooltip>
                            <Group>
                                {isEditingDisplayID ?
                                 <Textarea
                                     autosize
                                     macrows={1}
                                     value={workingDisplayID}
                                     onChange={event => {
                                         setWorkingDisplayID(event.currentTarget.value);
                                     }}
                                     styles={{ input: { font: "22px monospace" } }}
                                 /> :
                                 <Title order={3}>{displayId}</Title>
                                }                                
                                {isEditingDisplayID ? 
                                 <Group spacing={6}>
                                     <ActionIcon onClick={() => handleEndDisplayIDEdit(true)} color="red"><FaTimes /></ActionIcon>
                                     <ActionIcon onClick={() => handleEndDisplayIDEdit(false)} color="green"><FaCheck /></ActionIcon>
                                 </Group> :
                                <ActionIcon onClick={handleStartDisplayIDEdit}><FaPencilAlt /></ActionIcon>}
                            </Group>
                            <Tabs.List>
                                <Tabs.Tab value="overview">Overview</Tabs.Tab>
                                <Tabs.Tab value="sequence">Sequence</Tabs.Tab>
                                <Tabs.Tab value="text">Text</Tabs.Tab>
                                <Tabs.Tab value="proteins">Proteins</Tabs.Tab>
                            </Tabs.List>
                        </Group>
                        <Button
                            onClick={exportDocument}
                            variant="light"
                            rightIcon={<TbDownload />}
                        >
                            Save SBOL
                        </Button>
                    </Group>
                </Container>
            </Header>

            <Container>
                <Tabs.Panel value="overview" pt={20}>
                    <SplitPanel
                        left={<>
                                  <Title order={5} mb={10}>Description</Title>
                                  <Text color="dimmed">
                                      <ReactMarkdown linkTarget="_blank">
                                          {richDescription}
                                      </ReactMarkdown>
                                  </Text>
                                  <Space h={20} />
                                  <Title order={3}>Roles</Title>    
                                  <RoleSelection />
                                  <Space h={40} />
                                  <TargetOrganismsSelection />
                                  <Space h={40} />
                                  <References />                            
                              </>}
                        right={<SimilarParts />}
                    />
                </Tabs.Panel>

                <Tabs.Panel value="sequence" pt={20}>
                    <SplitPanel
                        left={<SequenceSection.Sequence colors={sequenceColors} />}
                        right={<SequenceSection.Annotations colors={sequenceColors} />}
                    />
                </Tabs.Panel>

                <Tabs.Panel value="text" pt={20}>
                    <ModalsProvider modals={{ addAndEdit: TextAnnotationModal }}>
                        <SplitPanel
                            left={<TextSection.Description colors={textColors} />}
                            right={<TextSection.Annotations colors={textColors} />}
                        />
                    </ModalsProvider>
                </Tabs.Panel>

                <Tabs.Panel value="proteins" pt={20}>
                    <SplitPanel
                        left={<ProteinSelection />}
                        right={<SuggestedProteins />}
                    />
                </Tabs.Panel>
            </Container>
        </Tabs>
    )
}

const tabStyles = theme => ({
    tab: {
        "&[data-active=true] *": {
            color: "white"
        }
    },
    tabLabel: {
        textTransform: "uppercase",
        fontWeight: 700,
        fontSize: "0.9rem",
        fontFamily: "monospace",
        // color: theme.colors.dark[3],
    },
    tabsList: {
        // paddingBottom: 8,
        // borderBottom: "1px solid " + theme.colors.gray[4]
    },
})
