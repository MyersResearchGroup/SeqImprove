import { Box, Button, Center, FileInput, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { MdOutlineFileUpload } from "react-icons/md"
import { useStore } from '../modules/store'


export default function UploadForm() {

    const loadSBOL = useStore(s => s.loadSBOL)

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
    })

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
    }

    const handleSubmit = async values => {
        switch (values.method) {
            case Methods.Upload:
                loadSBOL(await values.file.text())
                break
            case Methods.URL:
                loadSBOL(values.url)
                break
            default:
                break
        }
    }

    return (
        <Center sx={{ height: "90vh" }}>
            <Box>
                <Text align="center">Welcome to</Text>
                <Title align="center" mb={30}>SeqImprove</Title>
                <form onSubmit={form.onSubmit(handleSubmit)}>
                    <Stack w={400}>
                        <SegmentedControl data={Object.values(Methods)} {...form.getInputProps("method")} />
                        {methodForms[form.values.method]}
                        <Center mt={20}>
                            <Button type="submit">Submit</Button>
                        </Center>
                    </Stack>
                </form>
            </Box>
        </Center>
    )
}

const Methods = {
    Upload: "Upload a file",
    URL: "URL",
}