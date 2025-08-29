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
import { updateDocumentProperties } from '../modules/api'
import FormSection from './FormSection'

function validDisplayID(displayID) {
    return displayID.match(/^[a-z_]\w+$/i);
}

function SynBioHubClient({opened, onClose, setIsInteractingWithSynBioHub, synBioHubs, isEditingName, handleEndNameEdit}) {     
    const isLoggedInToSynBioHub = useStore(s => s.isLoggedInToSomeSynBioHub);

    return (
        <Modal
            title="SynBioHub"
            opened={opened}
            onClose={onClose}
            size={"auto"}
        >
            {isLoggedInToSynBioHub ?
             <SynBioHubClientUpload 
                 setIsInteractingWithSynBioHub={setIsInteractingWithSynBioHub} 
                 isEditingName={isEditingName}
                 handleEndNameEdit={handleEndNameEdit}
             /> :
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

function SynBioHubClientUpload({ setIsInteractingWithSynBioHub, isEditingName, handleEndNameEdit }) {        
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
                                    
                                    // create a Blob from the text - get fresh XML at export time
                                    // ensure any pending displayId/name changes are applied first
                                    if (isEditingName) {
                                        await handleEndNameEdit(false);
                                    }
                                    const currentXml = useStore.getState().exportDocument(false);
                                    const blob = new Blob([currentXml], { type: 'text/plain' });
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
                                  // create a Blob from the text - get fresh XML at export time
                                  // ensure pending displayId/name changes are applied first
                                  if (isEditingName) {
                                      await handleEndNameEdit(false);
                                  }
                                  const currentXml = useStore.getState().exportDocument(false);
                                  const blob = new Blob([currentXml], { type: 'text/plain' });
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
    const name = useStore(s => s.document?.root.title || s.document?.root.displayId)
    const richDescription = useStore(s => s.document?.root.richDescription)
    const source = useStore(s => s.document?.root.source)

    // colors for annotations
    const sequenceColors = useCyclicalColors(useStore(s => s.sequenceAnnotations.length))
    const textColors = useCyclicalColors(useStore(s => s.textAnnotations.length))

    // SynBioHub Login        
    const isLoggedInToSynBioHub = useStore(s => s.isLoggedInToSomeSynBioHub);
    const [ isInteractingWithSynBioHub, setIsInteractingWithSynBioHub ] = useState(false);    

    // exporting
    const exportDocument = useStore(s => s.exportDocument); 
    const sequence = useStore(s => {
        // try multiple ways to get the sequence
        const doc = s.document;
        if (!doc || !doc.root) return undefined;
        
        // method 1: direct sequence property
        if (doc.root.sequence) {
            return doc.root.sequence.toLowerCase();
        }
        
        // method 2: through sequences array
        if (doc.root.sequences && doc.root.sequences[0] && doc.root.sequences[0].elements) {
            return doc.root.sequences[0].elements.toLowerCase();
        }
        
        return undefined;
    });
   
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

    const [ isEditingName, setIsEditingName ] = useState(false);
    const [ workingName, setWorkingName ] = useState(name);
    const [ workingDisplayID, setWorkingDisplayID ] = useState(displayId);
    const [ nameIsReadOnly, setNameIsReadOnly ] = useState(false);
    
    // source editing state
    const [ isEditingSource, setIsEditingSource ] = useState(false);
    const [ workingSource, setWorkingSource ] = useState(source);
    const [ sourceError, setSourceError ] = useState(false);

    const handleStartNameEdit = () => {
        setIsEditingName(true);
        setWorkingName(name);
        setWorkingDisplayID(displayId);
    };
    
    const handleEndNameEdit = async (cancelled = false) => {
        if (cancelled) {
            setIsEditingName(false);
            return;
        }

        if (!workingName || workingName.trim().length === 0) {
            showErrorNotification("Name cannot be empty.", "Please provide a valid name.");
            return;
        }

        if (!validDisplayID(workingDisplayID)) {
            showErrorNotification("DisplayID should contain only alphanumeric characters and underscores. The first character cannot be a number.");
            return;
        }

        setIsEditingName(false);       

        // use Python sbol2 library via API
        const sbolContent = useStore.getState().sbolContent;
        const result = await updateDocumentProperties(sbolContent, workingName, workingDisplayID);
        
        if (result.error) {
            showErrorNotification("Failed to update document", result.error);
            return;
        }

        // update the document with the new SBOL content
        await useStore.getState().replaceDocumentForIDChange(result.sbolContent);
        
        // add small delay to ensure state is fully updated
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // refresh working values to reflect the updated document
        const updatedDisplayId = useStore.getState().document?.root.displayId;
        const updatedName = useStore.getState().document?.root.title || updatedDisplayId;
        setWorkingDisplayID(updatedDisplayId);
        setWorkingName(updatedName);
    };

    const handleStartSourceEdit = () => {
        setIsEditingSource(true);
        setWorkingSource(source);
        setSourceError(false);
    };
    
    const handleEndSourceEdit = (cancelled = false) => {
        if (cancelled) {
            setIsEditingSource(false);
            setSourceError(false);
            return;
        }

        // validate source if provided
        if (workingSource && workingSource.trim()) {
            const trimmedSource = workingSource.trim();
            
            // check if it's a valid URL/URI
            try {
                new URL(trimmedSource);
            } catch {
                // also accept URIs that might not be full URLs
                const isValidUri = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmedSource);
                if (!isValidUri) {
                    setSourceError("Source should be a valid URL or URI");
                    return;
                }
            }
        }

        setIsEditingSource(false);
        setSourceError(false);

        // update the source in the document
        mutateDocument(useStore.setState, state => {
            state.document.root.source = workingSource?.trim() || '';
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
        if (!sequence || typeof sequence !== 'string') {
            return false;
        }
        
        const validChars = /^[actguryswkmbdhvnacdefghiklmnpqrstvwy.-\s]+$/i;
        if (sequence.match(validChars) === null) {
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
                                {isEditingName ?
                                 <Group direction="column" spacing={12}>
                                     <Group spacing={0} align="flex-start">
                                         <Text size="xs" color="dimmed" mb={4}>Display ID</Text>
                                     </Group>
                                     <Textarea
                                         autosize
                                         maxrows={1}
                                         value={workingDisplayID}
                                         onChange={event => {
                                             setWorkingDisplayID(event.currentTarget.value);
                                         }}
                                         styles={{ input: { font: "18px monospace" } }}
                                         placeholder="Display ID"
                                     />
                                     <Group spacing={0} align="flex-start">
                                         <Text size="xs" color="dimmed" mb={4}>Name</Text>
                                     </Group>
                                     <Textarea
                                         autosize
                                         maxrows={1}
                                         value={workingName}
                                         onChange={event => {
                                             setWorkingName(event.currentTarget.value);
                                         }}
                                         styles={{ input: { font: "18px monospace" } }}
                                         placeholder="Document name"
                                     />
                                 </Group> :
                                 <Title order={3}>{displayId}</Title>
                                }                                
                                {isEditingName ? 
                                 <Group spacing={6}>
                                     <ActionIcon onClick={() => handleEndNameEdit(true)} color="red"><FaTimes /></ActionIcon>
                                     <ActionIcon onClick={() => handleEndNameEdit(false)} color="green"><FaCheck /></ActionIcon>
                                 </Group> : !nameIsReadOnly &&
                                 <ActionIcon onClick={handleStartNameEdit}><FaPencilAlt /></ActionIcon>} 
                            </Group>
                            <Tabs.List>
                                <Tabs.Tab value="overview" onClick={() => {
                                              setNameIsReadOnly(false);                                              
                                          }}>Overview</Tabs.Tab>
                                <Tabs.Tab value="sequence" onClick={() => {
                                              if (isEditingName) {
                                                  handleEndNameEdit(true);
                                              }
                                              setNameIsReadOnly(true);
                                          }}>Sequence</Tabs.Tab>
                                <Tabs.Tab value="text" onClick={() => {
                                              if (isEditingName) {
                                                  handleEndNameEdit(true);                                              
                                              }
                                              setNameIsReadOnly(true);
                                          }}>Text</Tabs.Tab>
                                <Tabs.Tab value="proteins" onClick={() => {
                                              if (isEditingName) {
                                                  handleEndNameEdit(true);                                                  
                                              }
                                              setNameIsReadOnly(true);
                                          }}>Proteins</Tabs.Tab>
                            </Tabs.List>
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
                                        // only show validation error if sequence exists but is invalid
                                        // don't show error if sequence is just undefined/not loaded
                                        if(sequence && !isValid(sequence)){
                                            const errMessage = "SeqImprove only accepts DNA sequences with no ambiguities. Please submit a sequence with only ACTG bases."
                                            showErrorNotification(errMessage);
                                        }
                                    }}>Export Document</Button>
                                </Menu.Target>

                                {(!sequence || isValid(sequence)) && <Menu.Dropdown> 
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
                        </Group>
                        </Group>
                        </Container>
                        </Header>
                        <SynBioHubClient
                            opened={isInteractingWithSynBioHub}
                            setIsInteractingWithSynBioHub={setIsInteractingWithSynBioHub}
                            onClose={() => setIsInteractingWithSynBioHub(false)}
                            setOpened={setIsInteractingWithSynBioHub}                            
                            synBioHubs={synBioHubs}
                            isEditingName={isEditingName}
                            handleEndNameEdit={handleEndNameEdit}
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
                                              <Space h={40} />
                                              <FormSection title="Source" rightSection={
                                                  isEditingSource ? (
                                                      <Group spacing={6}>
                                                          <ActionIcon onClick={() => handleEndSourceEdit(true)} color="red">
                                                              <FaTimes />
                                                          </ActionIcon>
                                                          <ActionIcon onClick={() => handleEndSourceEdit(false)} color="green">
                                                              <FaCheck />
                                                          </ActionIcon>
                                                      </Group>
                                                  ) : (
                                                      <ActionIcon onClick={handleStartSourceEdit}>
                                                          <FaPencilAlt />
                                                      </ActionIcon>
                                                  )
                                              }>
                                                  {isEditingSource ? (
                                                      <TextInput
                                                          value={workingSource}
                                                          onChange={(e) => {
                                                              setWorkingSource(e.currentTarget.value);
                                                              if (sourceError) setSourceError(false);
                                                          }}
                                                          placeholder="Enter URL/URI where this sequence was obtained"
                                                          error={sourceError}
                                                          onKeyDown={(e) => {
                                                              if (e.key === 'Enter') {
                                                                  handleEndSourceEdit(false);
                                                              } else if (e.key === 'Escape') {
                                                                  handleEndSourceEdit(true);
                                                              }
                                                          }}
                                                      />
                                                  ) : (
                                                      <Text color="dimmed">
                                                          {source ? source : "No source specified"}
                                                      </Text>
                                                  )}
                                              </FormSection>                            
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
