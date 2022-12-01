import { useEffect } from 'react'
import { NotificationsProvider } from '@mantine/notifications'
import { useStore } from './modules/store'
import CurationForm from './components/CurationForm'
import UploadForm from './components/UploadForm'
import { MantineProvider } from '@mantine/core'


export default function App() {

    const loadSBOL = useStore(s => s.loadSBOL)

    const sbolUri = useStore(s => s.uri)
    const hasSbolContent = useStore(s => !!s.sbolContent)

    // load SBOL into store if we have a complete_sbol parameter
    useEffect(() => {
        sbolUri && loadSBOL(sbolUri)
    }, [sbolUri])

    return (
        <MantineProvider theme={theme} withNormalizeCSS withGlobalStyles>
            <NotificationsProvider>
                {sbolUri || hasSbolContent ?
                    <CurationForm />
                    :
                    <UploadForm />}
            </NotificationsProvider>
        </MantineProvider>
    )
}


const theme = {
    primaryColor: "teal",
}