import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import WebGate from "./web/WebGate";
import { IS_WEB } from "./web/platform";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      {IS_WEB ? (
        <WebGate>
          <App />
        </WebGate>
      ) : (
        <App />
      )}
    </BrowserRouter>
  </React.StrictMode>
);
