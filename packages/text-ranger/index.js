

export class TextBuffer {

    constructor(text) {
        this.text = text
        this.originalText = text

        this.transforms = []
    }

    modifyRange(start, end, newText) {
        /**
         * Start by projecting the start and end indeces against the existing
         * transforms.
         */
        start = this.projectIndex(start)
        end = this.projectIndex(end)

        // Enforce ordering conventions
        if (start > end)
            throw Error("Start index must be less than or equal to end index.")

        // Calculate original text length
        const originalLength = end - start

        /**
         * Any replacements that result in less characters than the original text
         * will result in a range where the result has been removed.
         */
        if (newText.length < originalLength)
            this.transforms.push(createErrorRange(start + newText.length, end))

        /**
         * Everything after the end index needs to be adjusted by the difference
         * between the new length and the original length.
         */
        const adjustment = newText.length - originalLength
        this.transforms.push(createTransform(end, adjustment))

        // Make the replacement
        const oldText = this.text.slice(start, end)
        this.text = this.text.slice(0, start) + newText + this.text.slice(end)
        return oldText
    }

    projectIndex(index) {
        return this.transforms.reduce((accum, transform) => transform(accum), index)
    }

    getText(start, end) {
        // Enforce ordering conventions
        if (start > end)
            throw Error("Start index must be less than or equal to end index.")

        return start === undefined ? this.text : this.text.slice(
            this.projectIndex(start),
            this.projectIndex(end ?? start + 1)
        )
    }
}


function createTransform(threshold, adjustment) {
    return index => index + (index >= threshold ? adjustment : 0)
}

function createErrorRange(start, end) {
    return index => {
        if (index >= start && index < end)
            throw new Error(`Index ${index} has been removed.`)
        return index
    }
}