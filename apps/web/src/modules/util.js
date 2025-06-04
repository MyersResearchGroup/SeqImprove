import { showNotification } from "@mantine/notifications"
import { Text, List } from "@mantine/core"
import React from "react"

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
    // handle array messages by converting them to a formatted React component
    const formattedMessage = Array.isArray(message) 
        ? React.createElement('div', null, 
            message.map((line, index) => {
                if (line === "") {
                    return React.createElement('div', { 
                        key: index, 
                        style: { marginBottom: "8px" } 
                    });
                } else if (line.startsWith("• ")) {
                    return React.createElement(Text, { 
                        key: index, 
                        style: { marginLeft: "16px", marginBottom: "4px" } 
                    }, line);
                } else {
                    return React.createElement(Text, { 
                        key: index, 
                        style: { marginBottom: "4px" } 
                    }, line);
                }
            })
        )
        : message;

    showNotification({
        title,
        color: "red",
        message: formattedMessage,
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
