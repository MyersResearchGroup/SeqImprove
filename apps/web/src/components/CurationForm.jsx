import { Container, Title, Tabs, Text, Space, LoadingOverlay, Button, Group, Header, List, ActionIcon, Tooltip, Textarea, Menu, Modal, TextInput, PasswordInput, Loader, Center, Select, SegmentedControl, Checkbox, TypographyStylesProvider } from '@mantine/core'
import { useStore, mutateDocument, mutateDocumentForDisplayID } from '../modules/store'
import { useCyclicalColors } from "../hooks/misc"
import SimilarParts from './SimilarParts'
import RoleSelection from "./RoleSelection"
import TypeSelection from "./TypeSelection"
import ProteinSelection from './ProteinSelection'
import SplitPanel from "./SplitPanel"
import TargetOrganismsSelection from './TargetOrganismsSelection'
import SuggestedProteins from './SuggestedProteins'
import SequenceSection from './SequenceSection'
import TextSection from './TextSection'
import { ModalsProvider } from '@mantine/modals'
import TextAnnotationModal from './TextAnnotationModal'
import { TbDownload, TbUpload } from "react-icons/tb"
import ReactMarkdown from 'react-markdown'
import References from './References'
import { FaHome, FaPencilAlt, FaTimes, FaCheck } from 'react-icons/fa'
import { useState } from "react"
import { showErrorNotification, showNotificationSuccess } from "../modules/util"
import { Graph, SBOL2GraphView } from "sbolgraph"
import { createSBOLDocument } from '../modules/sbol'

function validDisplayID(displayID) {
    return displayID.match(/^[a-z_]\w+$/i);
}

function SynBioHubClient({opened, onClose, setIsInteractingWithSynBioHub, synBioHubs}) {     
    const isLoggedInToSynBioHub = useStore(s => s.isLoggedInToSomeSynBioHub);

    return (
        <Modal
            title="SynBioHub"
            opened={opened}
            onClose={onClose}
            size={"auto"}
        >
            {isLoggedInToSynBioHub ?
             <SynBioHubClientUpload setIsInteractingWithSynBioHub={setIsInteractingWithSynBioHub} /> :
             <SynBioHubClientLogin synBioHubs={synBioHubs} />
            }            
        </Modal>
    );
}

export function SynBioHubClientLogin({ synBioHubs }) {       
    const [email, setEmail] = useState('');    
    const [password, setPassword] = useState('');
    const [inputError, setInputError] = useState(false);
    const isLoggedInToSynBioHub = useStore(s => s.isLoggedInToSomeSynBioHub);
    const loginToSynBioHubFn = useStore(s => s.login);
    const [ workingSynBioHubUrlPrefix, setWorkingSynBioHubUrlPrefix ] = useState('');            
    const [ isLoading, setIsLoading ] = useState(false);

    return (
        <Group>
            <Title order={3}>Login</Title>
            <Group>
                <Select
                    label="Online database"
                    placeholder="Pick one"
                    data={synBioHubs}                      
                    onChange={(v) => {                          
                        setWorkingSynBioHubUrlPrefix(v);
                    }}
                    searchable                        
                    creatable
                    getCreateLabel={(query) => `Custom SBH: ${query}`}
                    onCreate={(query) => {
                    const item = { value: query, label: query };
                        synBioHubs.push(query)
                        return item;
                    }}
                />
                <TextInput                   
                    label="Email"
                    value={email}
                    onChange={(e) => setEmail(e.currentTarget.value)}
                    withAsterisk
                    error={inputError != false}
                />                    
                <PasswordInput
                    placeholder="123456"
                    label="Password"
                    value={password}                        
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    withAsterisk
                    error={inputError}
                />                    
                {isLoading ? 
                 <Center>
                     <Loader my={30} size="sm" variant="dots" />
                 </Center> :
                 <Button onClick={async () => {                                
                             const params = new URLSearchParams();
                             params.append('email', email);
                             params.append('password', password);
                             const synbiohub_url_login = workingSynBioHubUrlPrefix + "/login";
                             setIsLoading(true);
                             const response = await fetch(synbiohub_url_login, {
                                 method: "POST",
                                 headers: {"Accept": "text/plain"},
                                 body: params,
                             });
                             setIsLoading(false);

                             if (response.ok) {
                                 setInputError(false);
                                 const session_token = await response.text();
                                localStorage.setItem("synBioHubs", JSON.stringify(synBioHubs))
                                 loginToSynBioHubFn(session_token, workingSynBioHubUrlPrefix);
                                 
                             } else if (response.status == 401) {
                                 setInputError("Unable to log in with these credentials");
                             } else {
                                 setInputError("There was a problem logging in to SynBioHub.");
                             }
                         }}>
                     Submit
                 </Button>
                }                    
            </Group>

        </Group>            
    );
}

function SynBioHubClientUpload({ setIsInteractingWithSynBioHub }) {        
    const synBioHubUrlPrefix = useStore(s => s.synBioHubUrlPrefix);
    const [ synBioHubSessionToken, _ ] = useState(sessionStorage.getItem('SynBioHubSessionToken'));   
    const [inputError, setInputError] = useState(false);
    const [ isLoading, setIsLoading ] = useState(false);
    const [ id, setID ] = useState("collection_id");
    const [ version, setVersion ] = useState("1");
    const [ name, setName ] = useState("the name");
    const [ description, setDescription ] = useState("The description");
    const [ citations, setCitations ] = useState([]);
    const [ rootCollectionsLoaded, setRootCollectionsLoaded ] = useState(false);
    const [ rootCollectionsIDs, setRootCollectionsIDs ] = useState([]);
    const [ rootCollections, setRootCollections ] = useState([]);
    const [ rootCollectionURI, setRootCollectionURI ] = useState('');

    const xml = useStore(s => s.serializeXML());        

    (async () => {        
        if (!rootCollectionsLoaded) { // curl -X GET -H "Accept: text/plain" -H "X-authorization: 5ab3af6e-2ddd-4ac2-af76-d4285d2ffe03" https://synbiohub.org/rootCollections
            console.log(synBioHubSessionToken);
            console.log(synBioHubUrlPrefix);
            const response2 = await fetch(synBioHubUrlPrefix + "/rootCollections", {                
                method: "GET",
                headers: {
                    "Accept": "text/plain",
                    "X-authorization": synBioHubSessionToken,
                },
            });            

            const _rootCollections = await response2.json();
            
            // const userRootCollections = _rootCollections.filter(collection => collection.uri.match(/https:\/\/synbiohub.org\/user\/*/));
            let regex = RegExp(synBioHubUrlPrefix + "/user/*");
            const userRootCollections = _rootCollections.filter(collection => collection.uri.match(regex));
            setRootCollections(userRootCollections);
            setRootCollectionsIDs(userRootCollections.map(collection => collection.displayId));
            setRootCollectionsLoaded(true);
        }           
    })();

    const [ createNewOption, setCreateNewOption ] = useState('false');
    const [ inputErrorID, setInputErrorID ] = useState(false);
    const [ inputErrorVersion, setInputErrorVersion ] = useState(false);
    const [ overwrite, setOverwrite ] = useState(false);

    return (                        
        <Group>
            <Title order={3}>Upload to SynBioHub</Title>
            <Group>
                <SegmentedControl
                    value={createNewOption}
                    onChange={setCreateNewOption}
                    data={[
                        { label: 'Use existing collection', value: 'false' },
                        { label: 'Create new collection', value: 'true' },                             
                    ]}
                />
                {createNewOption === 'true' ?
                 <Group>
                     <TextInput                   
                         label="ID"
                         value={id}
                         description="And identifier for the Collection: Alphanumeric and underscores only, ex. BBa_R0010"
                         onChange={(e) => {
                             const str = e.currentTarget.value;
                             setID(e.currentTarget.value);
                             if (str.match(/^[a-zA-Z_]\w*$/)) {                                     
                                 setInputErrorID(false);
                             } else {
                                 setInputErrorID("Invalid id - must start with letter or underscore");
                             }                                 
                         }}
                         withAsterisk
                         error={inputErrorID}
                     />                    
                     <TextInput
                         placeholder="1"
                         label="Version"
                         value={version}
                         description="the version string to associate with the submission, (ex. 1)"
                         onChange={(e) => {
                             const version_str = e.currentTarget.value;                                 
                             setVersion(version_str);
                             if (version_str.match(/^(\d|\.)+$/)) {
                                 setInputErrorVersion(false);
                             } else {
                                 setInputErrorVersion("Invalid version");
                             }                                                                  
                         }}
                         withAsterisk
                         error={inputErrorVersion}
                     />
                     <TextInput
                         label="Name"
                         value={name}
                         description="The name of the submission"
                         onChange={(e) => setName(e.currentTarget.value)}
                         withAsterisk
                         error={inputError != false}
                     />
                     <Textarea
                         label="Description"
                         value={description}
                         onChange={(e) => setDescription(e.currentTarget.value)}
                         withAsterisk
                         error={inputError != false}
                     />
                     <TextInput
                         label="Citations"
                         value={citations.join(',')}
                         description="Comma separated pubmed IDs of citations to store with the submission"
                         onChange={(e) => {
                             const cits = e.currentTarget.value.split(',');
                             setCitations(cits.slice(0, cits.length-1).map(cit => cit.trim()).concat(cits.slice(-1)))
                         }}                         
                         error={inputError != false}
                     />
                     <Checkbox checked={overwrite} label="Overwrite?" description="Overwrite if submission exists" onChange={(event) => setOverwrite(event.currentTarget.checked)} />
                     <Button onClick={async () => {
                                 if (inputErrorID || inputErrorVersion) {
                                     showErrorNotification("Invalid Input", "Please address the issue and then submit.");
                                 } else {
                                     const params = new FormData();
                                     params.append('id', id);
                                     params.append('version', version);
                                     params.append('name', name);
                                     params.append('description', description);
                                     params.append('citations', citations.map(cit => cit.trim()).join(','));
                                     params.append('overwrite_merge', overwrite ? 1 : 0);
                                     
                                     // Create a Blob from the text
                                     const blob = new Blob([xml], { type: 'text/plain' });
                                     params.append('file', blob, 'file.txt');
                                     const url = synBioHubUrlPrefix + "/submit"; // submit to dynamic url prefix

                                     setIsLoading(true);
                                     const response = await fetch(url, {
                                         method: "POST",
                                         headers: {
                                             "Accept" : "text/plain; charset=UTF-8",
                                             "X-authorization" : synBioHubSessionToken,
                                         },
                                         body: params,
                                     });
                                     setIsLoading(false);                             

                                     if (response.ok) {
                                         setInputError(false);
                                         setIsInteractingWithSynBioHub(false);
                                         showNotificationSuccess("Success!", "Uploaded to new collection.");
                                     } else if (response.status == 401) {                                             
                                         showErrorNotification("Failure.", "SynBioHub did not accept the request");
                                     } else {                                             
                                         showErrorNotification("Failure.", "SynBioHub did not accept the request");
                                     }
                                 }                                                                          
                             }}>
                         Submit
                     </Button>
                 </Group>:
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
                          }}
                          searchable
                      />
                     }

                     <Checkbox checked={overwrite} label="Overwrite?" onChange={(event) => setOverwrite(event.currentTarget.checked)} />

                     {isLoading ? 
                      <Center>
                          <Loader my={30} size="sm" variant="dots" />
                      </Center> :
                      <Button onClick={async () => {                                                                  
                                  const params = new FormData();                                                                                                                                                                        
                                  params.append('overwrite_merge', overwrite ? 3 : 2);                                                                                                                       
                                  params.append('rootCollections', rootCollectionURI);
                                  // Create a Blob from the text
                                  const blob = new Blob([xml], { type: 'text/plain' });
                                  params.append('file', blob, 'example.txt');
                                  const url = synBioHubUrlPrefix + "/submit"; // submit to dynamic url prefix

                                  setIsLoading(true);
                                  const response = await fetch(url, {
                                      method: "POST",
                                      headers: {
                                          "Accept" : "text/plain; charset=UTF-8",
                                          "X-authorization" : synBioHubSessionToken,
                                      },
                                      body: params,
                                  });
                                  setIsLoading(false);                             

                                  if (response.ok) {
                                      setInputError(false);
                                      setIsInteractingWithSynBioHub(false);
                                      showNotificationSuccess("Success!", "Uploaded to existing collection.");
                                  } else if (response.status == 401) {                                                                                                                            
                                      showErrorNotification("Failure.", "SynBioHub did not accept the request");
                                  } else {                                          
                                      showErrorNotification("Failure.", "SynBioHub did not accept the request");
                                  }
                              }}>
                          Submit
                      </Button>
                     }
                 </Group>
                }                 
            </Group>
        </Group> 
    )
}

export default function CurationForm({ }) {

    const displayId = useStore(s => s.document?.root.displayId)
    const richDescription = useStore(s => s.document?.root.richDescription)

    // colors for annotations
    const sequenceColors = useCyclicalColors(useStore(s => s.sequenceAnnotations.length))
    const textColors = useCyclicalColors(useStore(s => s.textAnnotations.length))

    // SynBioHub Login        
    const isLoggedInToSynBioHub = useStore(s => s.isLoggedInToSomeSynBioHub);
    const [ isInteractingWithSynBioHub, setIsInteractingWithSynBioHub ] = useState(false);    

    // exporting
    const exportDocument = useStore(s => s.exportDocument); 
    const sequence = useStore(s => s.document?.root.sequence)?.toLowerCase();
   
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
    const [ displayIDisReadOnly, setDisplayIDisReadOnly ] = useState(false);

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

        mutateDocumentForDisplayID(useStore.setState, async state => {
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

            await state.replaceDocumentForIDChange(newSBOLcontent);      
        });
    };
        
    const logout = useStore(s => s.logout);
    const [ synBioHubs, setSynBioHubs ] = useState([]);    

    const loadSynBioHubs = async () => {
        const response = await fetch("https://wor.synbiohub.org/instances");
        const registries = await response.json();
        if (localStorage.getItem("synBioHubs")) setSynBioHubs(JSON.parse(localStorage.getItem("synBioHubs")))
        else setSynBioHubs(registries.map(r => r.uriPrefix));
    };

    function isValid(sequence) {
        if (sequence.match(/^[actguryswkmbdhvnacdefghiklmnpqrstvwy.-\s]+$/i) === null) { // contains invalid char
            return false;
        }
        return true;
    }

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
                                 </Group> : !displayIDisReadOnly &&
                                 <ActionIcon onClick={handleStartDisplayIDEdit}><FaPencilAlt /></ActionIcon>} 
                            </Group>
                            <Tabs.List>
                                <Tabs.Tab value="overview" onClick={() => {
                                              setDisplayIDisReadOnly(false);                                              
                                          }}>Overview</Tabs.Tab>
                                <Tabs.Tab value="sequence" onClick={() => {
                                              if (isEditingDisplayID) {
                                                  handleEndDisplayIDEdit(true);
                                              }
                                              setDisplayIDisReadOnly(true);
                                          }}>Sequence</Tabs.Tab>
                                <Tabs.Tab value="text" onClick={() => {
                                              if (isEditingDisplayID) {
                                                  handleEndDisplayIDEdit(true);                                              
                                              }
                                              setDisplayIDisReadOnly(true);
                                          }}>Text</Tabs.Tab>
                                <Tabs.Tab value="proteins" onClick={() => {
                                              if (isEditingDisplayID) {
                                                  handleEndDisplayIDEdit(true);                                                  
                                              }
                                              setDisplayIDisReadOnly(true);
                                          }}>Proteins</Tabs.Tab>
                            </Tabs.List>
                        </Group>
                        {isLoggedInToSynBioHub ?
                         <Button variant="subtle"
                                 onClick={logout}
                         >
                             Log out
                         </Button> :
                         <p></p>
                        }                        
                        <Menu shadow="md" width={200}>
                            <Menu.Target>
                                <Button onClick={()=>{
                                    if(!isValid(sequence)){
                                        //showMessage if inValid
                                        const errMessage = "SeqImprove only accepts DNA sequences with no ambiguities. Please submit a sequence with only ACTG bases."
                                        showErrorNotification(errMessage);
                                    }
                                }}>Export Document</Button>
                            </Menu.Target>

                            {isValid(sequence) && <Menu.Dropdown> 
                                <Menu.Item onClick={exportDocument}> 
                                    Download SBOL2 {<TbDownload />}
                                </Menu.Item>
                                <Menu.Item onClick={() => {
                                               loadSynBioHubs();
                                               setIsInteractingWithSynBioHub(true);
                                           }}>
                                    Upload to SynBioHub {<TbUpload />}
                                </Menu.Item>
                            </Menu.Dropdown>}
                        </Menu>
                        {/* <Button onClick={exportDocument} variant="light" rightIcon={<TbDownload />}>
                            Save SBOL
                            </Button> */}
                        </Group>
                        </Container>
                        </Header>
                        <SynBioHubClient
                            opened={isInteractingWithSynBioHub}
                            setIsInteractingWithSynBioHub={setIsInteractingWithSynBioHub}
                            onClose={() => setIsInteractingWithSynBioHub(false)}
                            setOpened={setIsInteractingWithSynBioHub}                            
                            synBioHubs={synBioHubs}
                        />                        
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
                                              <RoleSelection />
                                              <TypeSelection />
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
