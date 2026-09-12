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
    import("./store/combat"),
    import("./store/characters"),
    import("./store/tools"),
    import("./store/compendium"),
    import("./store/history"),
    import("./store/sceneList"),
    import("./store/encounters"),
    import("./store/ui"),
  ]).then(([c, r, t, ch, cb, ca, tl, co, h, sl, en, ui]) => {
    Object.assign(window, {
      __vtt: {
        useConnection: c.useConnection,
        useRoom: r.useRoom,
        useTokens: t.useTokens,
        useChat: ch.useChat,
        useCombat: cb.useCombat,
        useCharacters: ca.useCharacters,
        useTools: tl.useTools,
        useCompendium: co.useCompendium,
        useHistory: h.useHistory,
        useSceneList: sl.useSceneList,
        useEncounters: en.useEncounters,
        useUi: ui.useUi,
      },
    });
  });
}
