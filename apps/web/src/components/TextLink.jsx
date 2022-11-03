import { Text } from "@mantine/core";

export default function TextLink({ children, href, target = "_blank", ...props }) {
    return (
        <Text {...props}>
            <a target={target} style={{ color: "inherit" }} href={href}>{children}</a>
        </Text>
    )
}
