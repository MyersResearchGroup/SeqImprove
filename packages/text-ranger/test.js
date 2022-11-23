import { TextBuffer } from "./index.js"


const buf = new TextBuffer("This part produces GFP. It was tested in E. coli  and is thought to work in B. subtilis. The circuit functions better when background levels of lactose are low. There is also lactse. E. coli  is the same as Escherichia coli.  Escichia coi.")

console.log(buf.getText())
console.log()

buf.modifyRange(5, 9, "cool part")

console.log(buf.getText())
console.log()

// buf.modifyRange(19, 22, "[GFP](code)")
buf.modifyRange(19, 22, old => `[${old}](code)`)

console.log(buf.getText())
console.log()

buf.modifyRange(41, 48, "[E. coli](...SO562...)")

console.log(buf.getText())
console.log()
