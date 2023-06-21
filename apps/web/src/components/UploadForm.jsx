import { Box, Button, Center, FileInput, Group, LoadingOverlay, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { MdOutlineFileUpload } from "react-icons/md"
import { useStore } from '../modules/store'


export default function UploadForm() {

    const loadSBOL = useStore(s => s.loadSBOL)
    const docLoading = useStore(s => s.loadingSBOL)

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
                loadSBOL(await values.file.text());
                break
            case Methods.URL:
                const url = values.url.match(/\/sbol$/) ? values.url : 
                            values.url.match(/\/$/) ?     values.url + 'sbol' : 
                                                          values.url + '/sbol';
                loadSBOL(url);
                break
            default:
                break
        }
    }

    const useTestFile = () => {
        loadSBOL(window.location.origin + "/Test_Part.xml");
    }

    return (
        <>
            <Center sx={{ height: "90vh" }}>
                <Box>
                    <Text align="center">Welcome to</Text>
                    <Title align="center" mb={30}>SeqImprove</Title>
                    <form onSubmit={form.onSubmit(handleSubmit)}>
                        <Stack w={400}>
                            <SegmentedControl data={Object.values(Methods)} {...form.getInputProps("method")} />
                            {methodForms[form.values.method]}
                            <Group mt={20} position="center">
                                <Button variant="outline" onClick={useTestFile}>Try with a test file!</Button>
                                <Button type="submit">Submit</Button>
                            </Group>
                        </Stack>
                    </form>
                </Box>
            </Center>
            <LoadingOverlay visible={docLoading} />
        </>
    )
}

const Methods = {
    Upload: "Upload a file",
    URL: "URL",
}
