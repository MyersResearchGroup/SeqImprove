import { Box, Card, Group, Text } from '@mantine/core'
import React from 'react'

export default function FormSection({ title, rightSection, titleOutside = false, children, grow, w }) {

    const titleComponent = <Text size="lg" weight={600}>{title}</Text>

    return (
        <Box sx={{
            width: w ?? "auto",
            flexGrow: grow ? 1 : 0,
            flexBasis: grow ? 0 : "auto",
        }} mb={20}>
            {titleOutside && titleComponent}
            <Card p="sm" radius="md" withBorder={true} sx={{ overflow: "visible" }}>
                {!titleOutside && <Card.Section withBorder inheritPadding py="sm" mb={10}>
                    <Group position="apart">
                        {titleComponent}
                        {rightSection}
                    </Group>
                </Card.Section>}
                {children}
            </Card>
        </Box>
    )
}
