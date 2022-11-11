import { Text } from '@mantine/core'
import { useEffect } from 'react'
import CurationForm from './components/CurationForm'
import UploadForm from './components/UploadForm'
import { useSearchParams } from './hooks/misc'
import { useStore } from './modules/store'

export default function App() {

    const loadSBOL = useStore(s => s.loadSBOL)

    const sbolUri = useStore(s => s.uri)
    const hasSbolContent = useStore(s => !!s.sbolContent)

    // load SBOL into store if we have a complete_sbol parameter
    useEffect(() => {
        sbolUri && loadSBOL(sbolUri)
    }, [sbolUri])

    return (
        sbolUri || hasSbolContent ?
            <CurationForm />
            :
            <UploadForm />
    )
}

