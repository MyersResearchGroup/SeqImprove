import { NavLink } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { FaPlus } from "react-icons/fa"
import { useStore } from '../modules/store'
import TextAnnotationModal from './TextAnnotationModal'

export default function AddTextAnnotation() {

    const addAnnotation = useStore(s => s.textAnnotationActions.addAnnotation)

    const [modalOpened, modal] = useDisclosure(false)

    const handleAdd = formValues => {
        addAnnotation({
            ...formValues,
            deletable: true,
        })
    }

    return (
        <>
            <NavLink
                label="Add Text Annotation"
                icon={<FaPlus />}
                variant="subtle"
                color="blue"
                active={true}
                onClick={modal.open}
                sx={{ borderRadius: 6 }}
            />
            <TextAnnotationModal opened={modalOpened} onClose={modal.close} onSubmit={handleAdd} />
        </>
    )
}