import { useEffect } from 'react'
import { NotificationsProvider } from '@mantine/notifications'
import { useStore } from './modules/store'
import CurationForm from './components/CurationForm'
import UploadForm from './components/UploadForm'
import { MantineProvider, Center, Box, Text, Space } from '@mantine/core'
import { getSearchParams } from './modules/util'
import { bootAPIserver } from "./modules/api"
import { FILE_TYPES } from "./modules/fileTypes"

export default function App() {

    bootAPIserver();
    const loadSBOL = useStore(s => s.loadSBOL)
    const documentLoaded = useStore(s => !!s.document)
    const isFileEdited = useStore((s) => s.isFileEdited);
    const cleanSBOLDocument = useStore((s) => s.cleanSBOLDocument);
    const isUriCleaned = useStore((s => s.isUriCleaned))
    const nameChanged = useStore((s => s.nameChanged))
    
    //add variable to keep track of name change

    useEffect(() => {
        // && !nameChanged
        if (isFileEdited && !isUriCleaned) {
            cleanSBOLDocument();
        }
        const paramsUri = getSearchParams().complete_sbol
        paramsUri && loadSBOL(paramsUri, FILE_TYPES.URL)
    }, [isFileEdited]);

    // name change effect - disabled to prevent displayId from being reset
    // useEffect(() => {
    //     if (nameChanged && !isUriCleaned) {
    //         cleanSBOLDocument();
    //     }
    // }, [nameChanged])


    // load SBOL into store if we have a complete_sbol parameter
    // useEffect(() => {
    //     const paramsUri = getSearchParams().complete_sbol
    //     paramsUri && loadSBOL(paramsUri)
    // }, [])

    return (
        <MantineProvider theme={theme} withNormalizeCSS withGlobalStyles>
            <NotificationsProvider>
                {documentLoaded ?
                    <CurationForm />
                    :
                    <UploadForm />}
                    <Center>
                        <Box sx={_ => { padding: "0 0 10px 0" }}>
                            <Text fz="xs" align="center">&copy; 2024 Genetic Logic Lab at the University of Colorado, Boulder</Text>
                            <Text fz="xs" align="center"><a target="_blank" href="https://github.com/MyersResearchGroup/SeqImprove">View Source on Github</a> | <a target="_blank" href="https://github.com/MyersResearchGroup/SeqImprove/issues/new">Report an Issue</a> | v1.0.0</Text>
                            <Space h="lg" />
                        </Box>                        
                    </Center>
                </NotificationsProvider>
        </MantineProvider>
    )
}


const theme = {
    primaryColor: "teal",
}
