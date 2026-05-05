import ReactDOM from 'react-dom/client'
import App from './App'
import "./modules/store"
// import "./index.css"
import "./main.css"
import { initEmbedListener } from "./modules/embedded"

window.global = window

initEmbedListener()

ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
)
