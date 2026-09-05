import { useEffect } from "react";
import { useRoute } from "./lib/router";
import { useConnection } from "./store/connection";
import { Lobby } from "./components/Lobby";
import { RoomPage } from "./components/RoomPage";
import { Toasts } from "./components/Toasts";

/** Raiz: escolhe a tela pela URL. "/" = Lobby, "/room/:code" = Mesa. */
export default function App() {
  const route = useRoute();
  const connect = useConnection((s) => s.connect);

  // Abre o socket cedo para o join ser imediato.
  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <>
      {route.name === "lobby" ? <Lobby /> : <RoomPage inviteCode={route.inviteCode} gmSecret={route.gmSecret} />}
      <Toasts />
    </>
  );
}
