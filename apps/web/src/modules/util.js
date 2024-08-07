import { showNotification } from "@mantine/notifications"

export function getSearchParams() {
    return new Proxy(
        new URLSearchParams(window.location.search),
        {
            get: (searchParams, prop) => searchParams.get(prop),
        }
    )
}

export function toTitleCase(text) {
    return text.toLowerCase()
        .replaceAll("_", " ")
        .split(" ")
        .map((s) => s.charAt(0).toUpperCase() + s.substring(1))
        .join(" ")
}


/*
    Colors
*/

export function getColor(theme, color, level = 3) {
    return theme.colors[color]?.[level] ?? color
}

export function generateCyclicalColors(themeColors, amount, level) {
    const result = []

    let index = 0
    while (result.length < amount) {
        const colorName = colorCycle[index++]
        result.push(
            level == null ?
                colorName :
                themeColors[colorName][level]
        )
        index >= colorCycle.length && (index = 0)
    }

    return result
}

const colorCycle = ["pink", "yellow", "teal", "indigo", "red", "lime", "cyan", "violet", "orange", "green", "blue", "grape"]

// Error handling

export function showErrorNotification(title, message) {
    showNotification({
        title,
        color: "red",
        message,
        autoClose: false,
    });
}

export function showWarningNotification(title, message) {
    showNotification({
        title,
        color: "orange",
        message,
        autoClose: false,
    });
}


export function showNotificationSuccess(title, message) {
    showNotification({
        title,
        color: "green",
        message,
        autoClose: true,
    });
}

export function showServerErrorNotification() {
    showNotification({
        title: "Failed to load resource",
        color: "red",
        message: "This is probably an issue with our servers. Sorry!",
        autoClose: false,
    });
}
