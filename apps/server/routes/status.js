
export default function status(app) {

    app.get("/status", (req, res) => {
        res.status(200).send({ message: "Up and running!" })
    })
}