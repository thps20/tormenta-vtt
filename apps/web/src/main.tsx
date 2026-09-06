import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Em desenvolvimento, expõe as stores no console para depuração (window.__vtt).
if (import.meta.env.DEV) {
  void Promise.all([
    import("./store/connection"),
    import("./store/room"),
    import("./store/tokens"),
    import("./store/chat"),
    import("./store/initiative"),
    import("./store/characters"),
    import("./store/tools"),
    import("./store/compendium"),
  ]).then(([c, r, t, ch, i, ca, tl, co]) => {
    Object.assign(window, {
      __vtt: {
        useConnection: c.useConnection,
        useRoom: r.useRoom,
        useTokens: t.useTokens,
        useChat: ch.useChat,
        useInitiative: i.useInitiative,
        useCharacters: ca.useCharacters,
        useTools: tl.useTools,
        useCompendium: co.useCompendium,
      },
    });
  });
}
