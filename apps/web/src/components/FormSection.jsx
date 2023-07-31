import { Box, Card, Group, Text } from '@mantine/core'
import React from 'react'

export default function FormSection({ title, rightSection, titleOutside = false, children, grow, w, style={
    width: w ?? "auto",
    flexGrow: grow ? 1 : 0,
    flexBasis: grow ? 0 : "auto",
} }) {

    const titleComponent = <Text size="lg" weight={600}>{title}</Text>

    return (
        <Box sx={style} mb={20}>
            {titleOutside && titleComponent}
            <Card p="sm" radius="md" withBorder={true} sx={{ overflow: "visible" }}>
                {!titleOutside && title && <Card.Section withBorder inheritPadding py="sm" mb={10}>
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
