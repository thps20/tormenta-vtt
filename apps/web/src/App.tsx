import { useEffect, useState } from "react";
import { useConnection } from "./store/connection";
import { SERVER_URL } from "./config";

type Health = { status: string; db: "ok" | "error"; uptime: number };

/** Tela "hello world": mostra se web ↔ server ↔ banco estão conversando. */
export default function App() {
  const { status, connect } = useConnection();
  const [health, setHealth] = useState<Health | "error" | null>(null);

  useEffect(() => {
    connect();
    fetch(`${SERVER_URL}/health`)
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth("error"));
  }, [connect]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">Tormenta VTT</h1>
      <p className="text-zinc-400">Hello world do monorepo. Nada de features ainda.</p>

      <ul className="grid gap-2 text-sm font-mono">
        <Row label="server HTTP" ok={health !== null && health !== "error"} pending={health === null} />
        <Row label="banco (Prisma)" ok={health !== null && health !== "error" && health.db === "ok"} pending={health === null} />
        <Row label="socket.io" ok={status === "connected"} pending={status === "connecting"} />
      </ul>
    </main>
  );
}

function Row({ label, ok, pending }: { label: string; ok: boolean; pending: boolean }) {
  const color = pending ? "text-yellow-400" : ok ? "text-emerald-400" : "text-red-400";
  const text = pending ? "…" : ok ? "OK" : "FALHOU";
  return (
    <li className="flex justify-between gap-8">
      <span>{label}</span>
      <span className={color}>{text}</span>
    </li>
  );
}
