import { useEffect } from "react";
import { useRoute } from "./lib/router";
import { useConnection } from "./store/connection";
import { Lobby } from "./components/Lobby";
import { RoomPage } from "./components/RoomPage";
import { DisplayPage } from "./components/DisplayPage";
import { Toasts } from "./components/Toasts";

/** Raiz: escolhe a tela pela URL. "/" = Lobby, "/room/:code" = Mesa, "/room/:code?display=" = Cast. */
export default function App() {
  const route = useRoute();
  const connect = useConnection((s) => s.connect);

  // Abre o socket cedo para o join ser imediato.
  useEffect(() => {
    connect();
  }, [connect]);

  if (route.name === "display") {
    // Cast (docs/plano-cast.md §3.1): sem <Toasts/> — erros só no console, a tela nunca mostra toast.
    return <DisplayPage inviteCode={route.inviteCode} displayToken={route.displayToken} />;
  }

  return (
    <>
      {route.name === "lobby" ? <Lobby /> : <RoomPage inviteCode={route.inviteCode} gmSecret={route.gmSecret} />}
      <Toasts />
    </>
  );
}
