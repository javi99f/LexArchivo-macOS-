import { useEffect, useMemo, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { ArchiveRestore, Database, FileArchive, Fingerprint, FolderOpen, KeyRound, Lock, Plus, RefreshCw, Save, Search, Settings, Share2, Shield, Trash2, UploadCloud, UserRound, X } from "lucide-react";
import { api } from "./lib/api";
import { checkDownloadAndInstallUpdate } from "./lib/updater";
import type { AppSettings, ClientSummary, EstadoExpediente, FullCase, LoginStatus, PendingNotification, SharedCasePackage, SharedCaseSummary, SharedPublishStatus, SyncStatus, TipoEvento } from "./types";

const estados: EstadoExpediente[] = ["Abierto", "Pendiente", "En juicio", "Cerrado", "Archivado"];
const tabs = ["Datos del cliente", "Expediente", "Parte contraria", "Cronologia", "Documentos", "Notas internas"] as const;
const eventTypes: TipoEvento[] = ["llamada", "reunion", "cita cliente", "escrito", "notificacion", "juicio", "plazo", "nota interna"];
const reminderOptions = [
  { value: 0, label: "Sin aviso" },
  { value: 5, label: "5 minutos antes" },
  { value: 10, label: "10 minutos antes" },
  { value: 20, label: "20 minutos antes" },
  { value: 30, label: "30 minutos antes" },
  { value: 60, label: "1 hora antes" },
  { value: 120, label: "2 horas antes" },
  { value: 1440, label: "1 dia antes" }
];

type Vista = "Clientes" | "Expedientes" | "Archivados" | "Uso Compartido" | "Copias de seguridad" | "Recien eliminado" | "Ajustes";

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "plain" | "danger" }) {
  const tone = props.tone ?? "plain";
  return (
    <button
      {...props}
      className={[
        "focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition",
        tone === "primary" ? "bg-acento text-white hover:bg-teal-800" : "",
        tone === "danger" ? "bg-vino text-white hover:bg-red-900" : "",
        tone === "plain" ? "border border-linea bg-white text-tinta hover:bg-stone-50" : "",
        props.className ?? ""
      ].join(" ")}
    />
  );
}

function Field(props: { label: string; value: string; onChange: (value: string) => void; type?: string; multiline?: boolean }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-stone-700">{props.label}</span>
      {props.multiline ? (
        <textarea className="focus-ring min-h-24 rounded-md border border-linea bg-white px-3 py-2" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      ) : (
        <input className="focus-ring rounded-md border border-linea bg-white px-3 py-2" type={props.type ?? "text"} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      )}
    </label>
  );
}

function ReadOnlyField(props: { label: string; value?: string; multiline?: boolean }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-stone-700">{props.label}</span>
      {props.multiline ? (
        <textarea className="min-h-24 rounded-md border border-linea bg-stone-50 px-3 py-2 text-stone-700" value={props.value ?? ""} readOnly />
      ) : (
        <input className="rounded-md border border-linea bg-stone-50 px-3 py-2 text-stone-700" value={props.value ?? ""} readOnly />
      )}
    </label>
  );
}

function describeCaseChanges(before: FullCase, after: FullCase) {
  const changes: string[] = [];
  const add = (label: string, previous?: string, next?: string) => {
    if ((previous ?? "") !== (next ?? "")) changes.push(`${label}: "${previous || "vacio"}" -> "${next || "vacio"}"`);
  };
  add("Cliente", before.client.name, after.client.name);
  add("DNI/NIE/CIF", before.client.tax_id, after.client.tax_id);
  add("Telefono", before.client.phone, after.client.phone);
  add("Email", before.client.email, after.client.email);
  add("Direccion", before.client.address, after.client.address);
  add("Observaciones", before.client.observations, after.client.observations);
  add("Tipo de asunto", before.expediente.matter_type, after.expediente.matter_type);
  add("Jurisdiccion", before.expediente.jurisdiction, after.expediente.jurisdiction);
  add("Estado", before.expediente.status, after.expediente.status);
  add("Descripcion", before.expediente.description, after.expediente.description);
  add("Abogado responsable", before.expediente.responsible_lawyer, after.expediente.responsible_lawyer);
  add("Proximo plazo", before.expediente.next_deadline, after.expediente.next_deadline);
  if (before.events.length !== after.events.length) changes.push(`Cronologia: ${before.events.length} -> ${after.events.length} entradas`);
  if (before.documents.length !== after.documents.length) changes.push(`Documentos: ${before.documents.length} -> ${after.documents.length} documentos`);
  if (before.notes.length !== after.notes.length) changes.push(`Notas internas: ${before.notes.length} -> ${after.notes.length} notas`);
  return changes;
}

type AppNotice = {
  id: string;
  title: string;
  body: string;
  kind: "event" | "update";
  caseId?: string;
  eventId?: string;
};

async function sendSystemNotice(notice: AppNotice, onOpen: () => void, enabled: boolean) {
  if (!enabled) return;
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) {
      sendNotification({ title: notice.title, body: notice.body });
      return;
    }
  } catch {
    // Si el plugin nativo no esta disponible en desarrollo, probamos con la notificacion del navegador.
  }
  if (!("Notification" in window)) return;
  const send = () => {
    const notification = new Notification(notice.title, { body: notice.body });
    notification.onclick = () => {
      window.focus();
      onOpen();
      notification.close();
    };
  };
  if (Notification.permission === "granted") send();
  else if (Notification.permission !== "denied") Notification.requestPermission().then((permission) => { if (permission === "granted") send(); });
}

function AccessScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [status, setStatus] = useState<LoginStatus | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const hasPassword = status?.has_password ?? false;

  useEffect(() => {
    api.getLoginStatus().then(setStatus).catch(() => setStatus({ has_password: false, failed_attempts: 0, locked_until: "", lockout_cycles: 0, hard_locked: false, windows_hello_available: false }));
  }, []);

  async function submit() {
    if (password.length < 8) {
      setMessage("Usa al menos 8 caracteres.");
      return;
    }
    if (!hasPassword) {
      const ok = await api.createMasterPassword(password);
      if (ok) onUnlocked();
      return;
    }
    const result = await api.verifyAccessPassword(password);
    if (result.unlocked) onUnlocked();
    else {
      setMessage(result.message);
      api.getLoginStatus().then(setStatus);
    }
  }

  async function hello() {
    const result = await api.unlockWithWindowsHello();
    if (result.unlocked) onUnlocked();
    else setMessage(result.message);
  }

  async function usbRecovery() {
    const result = await api.unlockWithUsbRecovery();
    if (result.unlocked) onUnlocked();
    else setMessage(result.message);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-papel p-6">
      <section className="w-full max-w-md rounded-lg border border-linea bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-md bg-acento text-white"><Shield size={22} /></div>
          <div>
            <h1 className="text-2xl font-semibold">LexArchivo</h1>
            <p className="text-sm text-stone-600">{hasPassword ? "Acceso seguro local" : "Crea la contrasena maestra"}</p>
          </div>
        </div>
        {status?.hard_locked && <p className="mb-4 rounded-md border border-vino bg-red-50 p-3 text-sm text-vino">La app esta bloqueada por seguridad. Inserta el USB de desbloqueo y pulsa Recuperar.</p>}
        {!status?.hard_locked && status?.locked_until && <p className="mb-4 rounded-md border border-aviso bg-amber-50 p-3 text-sm">Bloqueo temporal activo hasta {new Date(status.locked_until).toLocaleString("es-ES")}.</p>}
        <Field label="Contrasena maestra" type="password" value={password} onChange={setPassword} />
        {message && <p className="mt-3 text-sm text-vino">{message}</p>}
        <Button className="mt-6 w-full" tone="primary" onClick={submit}><Lock size={18} />Entrar</Button>
        {hasPassword && status?.windows_hello_available && !status.hard_locked && <Button className="mt-3 w-full" onClick={hello}><Fingerprint size={18} />Entrar con Windows Hello</Button>}
        {status?.hard_locked && <Button className="mt-3 w-full" onClick={usbRecovery}><KeyRound size={18} />Recuperar con USB</Button>}
      </section>
    </main>
  );
}

function Shell({ children, view, setView }: { children: React.ReactNode; view: Vista; setView: (view: Vista) => void }) {
  const mainItems: { label: Vista; icon: React.ReactNode }[] = [
    { label: "Clientes", icon: <UserRound size={18} /> },
    { label: "Expedientes", icon: <Database size={18} /> },
    { label: "Archivados", icon: <FileArchive size={18} /> },
    { label: "Uso Compartido", icon: <Share2 size={18} /> }
  ];
  const bottomItems: { label: Vista; icon: React.ReactNode }[] = [
    { label: "Copias de seguridad", icon: <ArchiveRestore size={18} /> },
    { label: "Recien eliminado", icon: <Trash2 size={18} /> },
    { label: "Ajustes", icon: <Settings size={18} /> }
  ];
  const renderItem = (item: { label: Vista; icon: React.ReactNode }) => (
    <button key={item.label} onClick={() => setView(item.label)} className={`focus-ring flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${view === item.label ? "bg-white font-semibold shadow-sm" : "hover:bg-white/60"}`}>
      {item.icon}{item.label}
    </button>
  );
  return (
    <div className="flex h-screen overflow-hidden bg-papel">
      <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-linea bg-[#ece5da] p-4">
        <h1 className="mb-6 text-xl font-semibold">LexArchivo</h1>
        <nav className="grid gap-1">
          {mainItems.map(renderItem)}
        </nav>
        <nav className="mt-auto grid gap-1 border-t border-linea pt-3">
          {bottomItems.map(renderItem)}
        </nav>
      </aside>
      <section className="min-w-0 flex-1 overflow-y-auto">{children}</section>
    </div>
  );
}

function Dashboard({ clients, mode, onSelect, onSelectClient, onNew }: { clients: ClientSummary[]; mode: "Clientes" | "Expedientes" | "Archivados"; onSelect: (id: string) => void; onSelectClient: (cases: ClientSummary[]) => void; onNew: () => void }) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState("modified");
  const [groupArchived, setGroupArchived] = useState(false);
  const filtered = useMemo(() => clients
    .filter((item) => {
      const text = `${item.name} ${item.case_number} ${item.matter_type} ${item.responsible_lawyer}`.toLowerCase();
      return text.includes(query.toLowerCase());
    })
    .sort((a, b) => {
      if (order === "az") return a.name.localeCompare(b.name, "es");
      if (order === "za") return b.name.localeCompare(a.name, "es");
      if (order === "opened") return b.opened_at.localeCompare(a.opened_at);
      if (order === "size") return a.name.localeCompare(b.name, "es");
      return b.updated_at.localeCompare(a.updated_at);
    }), [clients, query, order]);
  const groupedClients = useMemo(() => {
    const groups = new Map<string, { client_id: string; name: string; cases: ClientSummary[]; latest: ClientSummary }>();
    for (const item of filtered) {
      const current = groups.get(item.client_id);
      if (!current) {
        groups.set(item.client_id, { client_id: item.client_id, name: item.name, cases: [item], latest: item });
        continue;
      }
      current.cases.push(item);
      if (item.updated_at > current.latest.updated_at) current.latest = item;
    }
    return [...groups.values()].sort((a, b) => {
      if (order === "size") return b.cases.length - a.cases.length;
      if (order === "az") return a.name.localeCompare(b.name, "es");
      if (order === "za") return b.name.localeCompare(a.name, "es");
      if (order === "opened") return b.latest.opened_at.localeCompare(a.latest.opened_at);
      return b.latest.updated_at.localeCompare(a.latest.updated_at);
    });
  }, [filtered, order]);
  const showGrouped = mode === "Clientes" || (mode === "Archivados" && groupArchived);
  const title = mode;
  const subtitle = mode === "Clientes" ? "Una fila por cliente, con sus expedientes activos asociados." : mode === "Archivados" ? "Expedientes cerrados o archivados." : "Una fila por expediente activo.";
  return (
    <main className="p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{title}</h2>
          <p className="text-sm text-stone-600">{subtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button tone="primary" onClick={onNew}><Plus size={18} />Nuevo cliente</Button>
        </div>
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px_auto]">
        <label className="relative">
          <Search className="absolute left-3 top-3 text-stone-500" size={18} />
          <input className="focus-ring w-full rounded-md border border-linea bg-white py-2 pl-10 pr-3" placeholder="Buscar en clientes, expedientes y abogados" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select className="focus-ring rounded-md border border-linea bg-white px-3 py-2" value={order} onChange={(e) => setOrder(e.target.value)}>
          <option value="size">Tamano</option>
          <option value="opened">Abierto recientemente</option>
          <option value="modified">Modificado recientemente</option>
          <option value="az">Orden A - Z</option>
          <option value="za">Orden Z - A</option>
        </select>
        {mode === "Archivados" && <label className="flex items-center gap-2 rounded-md border border-linea bg-white px-3 py-2 text-sm"><input type="checkbox" checked={groupArchived} onChange={(e) => setGroupArchived(e.target.checked)} />Agrupar por clientes</label>}
      </div>
      <div className="overflow-hidden rounded-lg border border-linea bg-white">
        {showGrouped ? (
          <table className="w-full border-collapse text-sm">
            <thead className="bg-stone-100 text-left"><tr>{["Cliente", "Expedientes", "Ultimo asunto", "Estado", "Ultima modificacion"].map((h) => <th className="p-3" key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {groupedClients.map((client) => (
                <tr key={client.client_id} className="cursor-pointer border-t border-linea hover:bg-stone-50" onClick={() => client.cases.length === 1 ? onSelect(client.latest.case_id) : onSelectClient(client.cases)}>
                  <td className="p-3 font-medium">{client.name}</td>
                  <td className="p-3">{client.cases.length}</td>
                  <td className="p-3">{client.latest.case_number} · {client.latest.matter_type}</td>
                  <td className="p-3">{client.latest.status}</td>
                  <td className="p-3">{new Date(client.latest.updated_at).toLocaleString("es-ES")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="bg-stone-100 text-left"><tr>{["Nombre", "Numero de expediente", "Tipo", "Estado", "Abogado responsable", "Ultima modificacion"].map((h) => <th className="p-3" key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((client) => (
                <tr key={client.case_id} className="cursor-pointer border-t border-linea hover:bg-stone-50" onClick={() => onSelect(client.case_id)}>
                  <td className="p-3 font-medium">{client.name}</td><td className="p-3">{client.case_number}</td><td className="p-3">{client.matter_type}</td><td className="p-3">{client.status}</td><td className="p-3">{client.responsible_lawyer}</td><td className="p-3">{new Date(client.updated_at).toLocaleString("es-ES")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {filtered.length === 0 && <p className="p-4 text-sm text-stone-600">No hay resultados.</p>}
      </div>
    </main>
  );
}

function ClientFile({ full, knownClients, initialTab, highlightedEventId, onBack, onSaved, onDeleted, onClientsChanged, stayAfterSave = false, onSharedPublished }: { full: FullCase; knownClients: ClientSummary[]; initialTab?: (typeof tabs)[number]; highlightedEventId?: string; onBack: () => void; onSaved: (full?: FullCase) => void; onDeleted: () => void; onClientsChanged: () => void; stayAfterSave?: boolean; onSharedPublished?: () => void }) {
  const [tab, setTab] = useState<(typeof tabs)[number]>(initialTab ?? "Datos del cliente");
  const [draft, setDraft] = useState(full);
  const [publishStatus, setPublishStatus] = useState<SharedPublishStatus | null>(null);
  const clientOptions = useMemo(() => {
    const groups = new Map<string, ClientSummary>();
    for (const item of knownClients) if (!groups.has(item.client_id)) groups.set(item.client_id, item);
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [knownClients]);
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab, full.expediente.id]);
  useEffect(() => {
    setDraft(full);
  }, [full]);
  useEffect(() => {
    if (!full.expediente.id) {
      setPublishStatus(null);
      return;
    }
    api.getSharedPublishStatus(full.expediente.id).then(setPublishStatus).catch(() => setPublishStatus(null));
  }, [full.expediente.id]);

  async function refreshPublishStatus(caseId = draft.expediente.id) {
    if (!caseId) {
      setPublishStatus(null);
      return;
    }
    setPublishStatus(await api.getSharedPublishStatus(caseId));
  }

  async function save() {
    const saved = await api.saveClientCase({ client: draft.client, expediente: draft.expediente, opposing_party: draft.opposing_party ?? undefined });
    setDraft(saved);
    onSaved(saved);
    await refreshPublishStatus(saved.expediente.id);
    if (!stayAfterSave) onBack();
  }
  async function publishSharedUpdate() {
    if (!draft.expediente.id) return;
    const saved = await api.saveClientCase({ client: draft.client, expediente: draft.expediente, opposing_party: draft.opposing_party ?? undefined });
    const shared = await api.getSharedCase(saved.expediente.id);
    const changes = describeCaseChanges(shared.case_data, saved);
    const detail = changes.length > 0 ? changes.slice(0, 14).join("\n") : "No se han detectado cambios de datos. Se actualizara la fecha de publicacion.";
    if (!confirm(`Vas a actualizar este expediente en Uso Compartido.\n\nCambios detectados:\n${detail}\n\nContinuar?`)) {
      setDraft(saved);
      onSaved(saved);
      await refreshPublishStatus(saved.expediente.id);
      return;
    }
    await api.publishSharedCase(saved.expediente.id);
    setDraft(saved);
    onSaved(saved);
    await refreshPublishStatus(saved.expediente.id);
    onSharedPublished?.();
  }
  async function useExistingClient(caseId: string) {
    if (!caseId) {
      setDraft({ ...draft, client: { ...draft.client, id: "", name: "" }, expediente: { ...draft.expediente, client_id: "" } });
      return;
    }
    const existing = await api.getFullCase(caseId);
    setDraft({ ...draft, client: existing.client, expediente: { ...draft.expediente, client_id: existing.client.id } });
  }
  async function deleteRegisteredClient() {
    const selected = clientOptions.find((item) => item.client_id === draft.client.id);
    if (!selected) return;
    const count = knownClients.filter((item) => item.client_id === selected.client_id).length || 1;
    const ok = confirm(`Quieres mandar a Recien eliminado el cliente "${selected.name}" y sus ${count === 1 ? "expediente asociado" : "expedientes asociados"}?`);
    if (!ok) return;
    await api.moveClientToTrash(selected.client_id);
    onClientsChanged();
    if (draft.expediente.id && draft.expediente.client_id === selected.client_id) {
      onDeleted();
      return;
    }
    setDraft({ ...draft, client: { ...draft.client, id: "", name: "" }, expediente: { ...draft.expediente, client_id: "" } });
  }
  async function removeCase() {
    if (!draft.expediente.id) return;
    const ok = confirm("El expediente se movera a Recien eliminado y podras recuperarlo durante 30 dias. ¿Continuar?");
    if (!ok) return;
    await api.moveCaseToTrash(draft.expediente.id);
    onDeleted();
  }
  async function archive() {
    if (!draft.expediente.id) return;
    if (draft.expediente.status === "Archivado" || draft.expediente.status === "Cerrado") {
      await api.restoreCase(draft.expediente.id);
      onDeleted();
      return;
    }
    await api.archiveCase(draft.expediente.id);
    onDeleted();
  }
  const archived = draft.expediente.status === "Archivado" || draft.expediente.status === "Cerrado";
  const selectedRegisteredClient = clientOptions.find((item) => item.client_id === draft.client.id);
  return (
    <main className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <div><Button className="mb-3 px-4 py-2 text-base" onClick={onBack}>Volver</Button><h2 className="text-2xl font-semibold">{draft.client.name || "Nuevo cliente"}</h2><p className="text-sm text-stone-600">{draft.expediente.case_number || "El numero EXP-AAAA-XXX se asigna automaticamente"}</p></div>
        <div className="flex gap-2"><Button onClick={archive}>{archived ? "Desarchivar" : "Archivar"}</Button><Button tone="danger" disabled={!draft.expediente.id} onClick={removeCase}><Trash2 size={18} />Eliminar expediente</Button><Button tone="primary" onClick={save}><Save size={18} />Guardar</Button></div>
      </div>
      {publishStatus?.published && publishStatus.has_unpublished_changes && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-aviso bg-amber-50 p-3 text-sm">
          <p>Este expediente tiene cambios privados que todavia no estan publicados en Uso Compartido.</p>
          {publishStatus.can_edit && <Button onClick={publishSharedUpdate}><Share2 size={17} />Publicar cambios</Button>}
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-linea">{tabs.map((item) => <button className={`focus-ring rounded-t-md px-3 py-2 text-sm ${tab === item ? "bg-white font-semibold" : "hover:bg-white/70"}`} onClick={() => setTab(item)} key={item}>{item}</button>)}</div>
      {tab === "Datos del cliente" && <div className="grid gap-4 md:grid-cols-2"><label className="grid gap-1 text-sm md:col-span-2"><span className="font-medium text-stone-700">Usar cliente ya registrado</span><div className="grid gap-2 md:grid-cols-[1fr_auto]"><select className="focus-ring rounded-md border border-linea bg-white px-3 py-2" value={selectedRegisteredClient?.case_id ?? ""} onChange={(e) => useExistingClient(e.target.value)}><option value="">Nuevo cliente</option>{clientOptions.map((item) => <option key={item.client_id} value={item.case_id}>{item.name}</option>)}</select><button type="button" aria-label="Borrar cliente registrado" title="Borrar cliente registrado" disabled={!selectedRegisteredClient} className="focus-ring grid h-11 w-11 place-items-center rounded-md border border-linea bg-white text-stone-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40" onClick={deleteRegisteredClient}><X size={18} /></button></div></label><Field label="Nombre y apellidos o razon social" value={draft.client.name} onChange={(v) => setDraft({ ...draft, client: { ...draft.client, name: v } })} /><Field label="DNI, NIE o CIF" value={draft.client.tax_id} onChange={(v) => setDraft({ ...draft, client: { ...draft.client, tax_id: v } })} /><Field label="Telefono" value={draft.client.phone} onChange={(v) => setDraft({ ...draft, client: { ...draft.client, phone: v } })} /><Field label="Email" value={draft.client.email} onChange={(v) => setDraft({ ...draft, client: { ...draft.client, email: v } })} /><Field label="Direccion" value={draft.client.address} onChange={(v) => setDraft({ ...draft, client: { ...draft.client, address: v } })} /><Field label="Fecha de alta" type="date" value={draft.client.registration_date} onChange={(v) => setDraft({ ...draft, client: { ...draft.client, registration_date: v } })} /><div className="md:col-span-2"><Field multiline label="Observaciones" value={draft.client.observations} onChange={(v) => setDraft({ ...draft, client: { ...draft.client, observations: v } })} /></div></div>}
      {tab === "Expediente" && <div className="grid gap-4 md:grid-cols-2"><Field label="Tipo de asunto" value={draft.expediente.matter_type} onChange={(v) => setDraft({ ...draft, expediente: { ...draft.expediente, matter_type: v } })} /><Field label="Jurisdiccion" value={draft.expediente.jurisdiction} onChange={(v) => setDraft({ ...draft, expediente: { ...draft.expediente, jurisdiction: v } })} /><label className="grid gap-1 text-sm"><span className="font-medium text-stone-700">Estado</span><select className="focus-ring rounded-md border border-linea bg-white px-3 py-2" value={draft.expediente.status} onChange={(e) => setDraft({ ...draft, expediente: { ...draft.expediente, status: e.target.value as EstadoExpediente } })}>{estados.map((e) => <option key={e}>{e}</option>)}</select></label><Field label="Abogado responsable" value={draft.expediente.responsible_lawyer} onChange={(v) => setDraft({ ...draft, expediente: { ...draft.expediente, responsible_lawyer: v } })} /><Field label="Fecha de apertura" type="date" value={draft.expediente.opened_at} onChange={(v) => setDraft({ ...draft, expediente: { ...draft.expediente, opened_at: v } })} /><Field label="Fecha de cierre" type="date" value={draft.expediente.closed_at} onChange={(v) => setDraft({ ...draft, expediente: { ...draft.expediente, closed_at: v } })} /><Field label="Proximo plazo relevante" type="date" value={draft.expediente.next_deadline} onChange={(v) => setDraft({ ...draft, expediente: { ...draft.expediente, next_deadline: v } })} /><div className="md:col-span-2"><Field multiline label="Descripcion" value={draft.expediente.description} onChange={(v) => setDraft({ ...draft, expediente: { ...draft.expediente, description: v } })} /></div></div>}
      {tab === "Parte contraria" && <OpposingEditor full={draft} setDraft={setDraft} />}
      {tab === "Cronologia" && <TimelineWithReminders full={draft} reload={onSaved} highlightedEventId={highlightedEventId} />}
      {tab === "Documentos" && <DocumentsDrop full={draft} reload={onSaved} />}
      {tab === "Notas internas" && <Notes full={draft} reload={onSaved} />}
    </main>
  );
}

function OpposingEditor({ full, setDraft }: { full: FullCase; setDraft: (full: FullCase) => void }) {
  const op = full.opposing_party ?? { id: "", case_id: full.expediente.id, name: "", tax_id: "", phone: "", email: "", address: "", opposing_lawyer: "", opposing_firm: "", opposing_lawyer_phone: "", opposing_lawyer_email: "" };
  const set = (key: keyof typeof op, value: string) => setDraft({ ...full, opposing_party: { ...op, [key]: value } });
  return <div className="grid gap-4 md:grid-cols-2">{(["name:Nombre", "tax_id:DNI/CIF", "phone:Telefono", "email:Email", "address:Direccion", "opposing_lawyer:Abogado contrario", "opposing_firm:Despacho del abogado contrario", "opposing_lawyer_phone:Telefono abogado", "opposing_lawyer_email:Email abogado"] as const).map((item) => { const [key, label] = item.split(":") as [keyof typeof op, string]; return <Field key={key} label={label} value={String(op[key])} onChange={(v) => set(key, v)} />; })}</div>;
}

function Timeline({ full, reload }: { full: FullCase; reload: () => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState("nota interna");
  const sorted = [...full.events].sort((a, b) => a.event_date.localeCompare(b.event_date));
  return <section className="grid gap-4"><div className="grid gap-3 rounded-lg border border-linea bg-white p-4 md:grid-cols-[160px_180px_1fr_auto]"><Field label="Fecha" type="date" value={date} onChange={setDate} /><Field label="Tipo" value={type} onChange={setType} /><Field label="Titulo" value={title} onChange={setTitle} /><Button tone="primary" className="self-end" onClick={() => api.addEvent(full.expediente.id, { event_date: date, event_type: type, title, description: "" }).then(reload)}>Anadir</Button></div>{sorted.map((event) => <article key={event.id} className={`rounded-lg border p-4 ${event.event_type === "plazo" ? "border-aviso bg-amber-50" : "border-linea bg-white"}`}><div className="flex justify-between"><h3 className="font-semibold">{event.title}</h3><span className="text-sm">{event.event_date} · {event.event_type}</span></div><p className="mt-2 text-sm text-stone-700">{event.description}</p></article>)}</section>;
}

function TimelineWithReminders({ full, reload, highlightedEventId }: { full: FullCase; reload: () => void; highlightedEventId?: string }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("09:00");
  const [type, setType] = useState<TipoEvento>("nota interna");
  const [reminderMinutes, setReminderMinutes] = useState(0);
  const sorted = [...full.events].sort((a, b) => `${a.event_date} ${a.event_time}`.localeCompare(`${b.event_date} ${b.event_time}`));
  useEffect(() => {
    if (!highlightedEventId) return;
    window.setTimeout(() => document.getElementById(`event-${highlightedEventId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }, [highlightedEventId, full.events.length]);
  async function add() {
    await api.addEvent(full.expediente.id, { event_date: date, event_time: time, event_type: type, title, description: "", reminder_minutes: reminderMinutes });
    setTitle("");
    reload();
  }
  async function remove(eventId: string) {
    if (!confirm("Quieres borrar esta entrada de la cronologia?")) return;
    await api.removeEvent(eventId);
    reload();
  }
  return <section className="grid gap-4"><div className="grid gap-3 rounded-lg border border-linea bg-white p-4 md:grid-cols-[150px_120px_170px_190px_1fr_auto]"><Field label="Fecha" type="date" value={date} onChange={setDate} /><Field label="Hora" type="time" value={time} onChange={setTime} /><label className="grid gap-1 text-sm"><span className="font-medium text-stone-700">Tipo</span><select className="focus-ring rounded-md border border-linea bg-white px-3 py-2" value={type} onChange={(e) => setType(e.target.value as TipoEvento)}>{eventTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label className="grid gap-1 text-sm"><span className="font-medium text-stone-700">Aviso</span><select className="focus-ring rounded-md border border-linea bg-white px-3 py-2" value={reminderMinutes} onChange={(e) => setReminderMinutes(Number(e.target.value))}>{reminderOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><Field label="Titulo" value={title} onChange={setTitle} /><Button tone="primary" className="self-end" onClick={add}>Anadir</Button></div>{sorted.map((event) => <article id={`event-${event.id}`} key={event.id} className={`rounded-lg border p-4 ${highlightedEventId === event.id ? "border-acento bg-teal-50" : event.event_type === "plazo" ? "border-aviso bg-amber-50" : "border-linea bg-white"}`}><div className="flex justify-between gap-3"><div><h3 className="font-semibold">{event.title}</h3><span className="text-sm">{event.event_date}{event.event_time ? ` ${event.event_time}` : ""} - {event.event_type}</span></div><button aria-label="Borrar entrada" title="Borrar entrada" className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-full text-stone-500 hover:bg-rose-50 hover:text-rose-700" onClick={() => remove(event.id)}><X size={16} /></button></div>{event.reminder_minutes > 0 && <p className="mt-2 text-sm text-acento">Aviso {reminderOptions.find((item) => item.value === event.reminder_minutes)?.label.toLowerCase() ?? `${event.reminder_minutes} minutos antes`}</p>}<p className="mt-2 text-sm text-stone-700">{event.description}</p></article>)}</section>;
}

function Documents({ full, reload }: { full: FullCase; reload: () => void }) {
  const [paths, setPaths] = useState("");
  const [note, setNote] = useState("");
  return <section className="grid gap-4"><div className="rounded-lg border border-linea bg-white p-4"><p className="mb-3 text-sm text-stone-600">En la aplicacion de escritorio, pega una ruta por linea o usa el selector nativo en una version posterior.</p><Field multiline label="Rutas de archivos" value={paths} onChange={setPaths} /><Field label="Nota" value={note} onChange={setNote} /><Button className="mt-3" tone="primary" onClick={() => api.addDocuments(full.expediente.id, paths.split("\n").filter(Boolean), note).then(reload)}>Anadir documentos</Button></div>{full.documents.map((doc) => <article className="flex items-center justify-between rounded-lg border border-linea bg-white p-4" key={doc.id}><div><h3 className="font-semibold">{doc.original_name}</h3><p className="text-sm text-stone-600">{doc.relative_path} · {doc.note}</p></div><div className="flex gap-2"><Button><FolderOpen size={17} />Abrir carpeta</Button><Button onClick={() => api.removeDocument(doc.id, false).then(reload)}>Eliminar</Button><Button tone="danger" onClick={() => confirm("Primera confirmacion: eliminar tambien del disco") && confirm("Segunda confirmacion: esta accion no se puede deshacer") && api.removeDocument(doc.id, true).then(reload)}>Eliminar disco</Button></div></article>)}</section>;
}

function pathFromUri(uri: string) {
  if (!uri.startsWith("file://")) return "";
  const path = decodeURIComponent(new URL(uri).pathname);
  return path.match(/^\/[A-Za-z]:\//) ? path.slice(1).replace(/\//g, "\\") : path;
}

function droppedPaths(dataTransfer: DataTransfer) {
  const fromFiles = [...dataTransfer.files].map((file) => (file as File & { path?: string }).path ?? "").filter(Boolean);
  const fromUris = dataTransfer.getData("text/uri-list").split(/\r?\n/).map(pathFromUri).filter(Boolean);
  return [...new Set([...fromFiles, ...fromUris])];
}

function DocumentsDrop({ full, reload }: { full: FullCase; reload: () => void }) {
  const [paths, setPaths] = useState("");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const saved = Boolean(full.expediente.id);

  function appendPaths(nextPaths: string[]) {
    const cleanPaths = nextPaths.map((path) => path.trim()).filter(Boolean);
    if (cleanPaths.length === 0) {
      setMessage("No he podido leer la ruta del archivo. Usa el boton Seleccionar archivos o pega la ruta completa.");
      return;
    }
    setPaths((current) => [...current.split("\n").filter(Boolean), ...cleanPaths].join("\n"));
    setMessage(`${cleanPaths.length} documento(s) preparado(s). Pulsa Anadir documentos para guardarlos.`);
  }

  async function addPrepared(moveFiles: boolean) {
    if (!saved) {
      setMessage("Guarda primero el expediente. Despues podras anadir documentos.");
      return;
    }
    const cleanPaths = paths.split("\n").map((path) => path.trim()).filter(Boolean);
    if (cleanPaths.length === 0) {
      setMessage("Selecciona o arrastra archivos antes de anadirlos.");
      return;
    }
    await api.addDocuments(full.expediente.id, cleanPaths, "", moveFiles);
    setPaths("");
    setMessage(`${cleanPaths.length} documento(s) ${moveFiles ? "movido(s)" : "copiado(s)"} a la carpeta del expediente.`);
    reload();
  }

  useEffect(() => {
    if (!saved) return;
    let cleanup: (() => void) | undefined;
    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") setDragging(true);
      if (event.payload.type === "leave") setDragging(false);
      if (event.payload.type === "drop") {
        setDragging(false);
        appendPaths(event.payload.paths);
      }
    }).then((unlisten) => { cleanup = unlisten; }).catch(() => setMessage("No se pudo activar el arrastre nativo de documentos."));
    return () => cleanup?.();
  }, [full.expediente.id, saved]);

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    appendPaths(droppedPaths(event.dataTransfer));
  }

  async function openFolder() {
    try {
      if (!saved) {
        setMessage("Guarda primero el expediente para crear su carpeta.");
        return;
      }
      await api.openCaseDocumentsFolder(full.expediente.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo abrir la carpeta del documento.");
    }
  }

  return <section className="grid gap-4"><div className="grid gap-3 rounded-lg border border-linea bg-white p-4">{!saved ? <p className="rounded-md border border-aviso bg-amber-50 p-3 text-sm">Guarda primero el expediente. Cuando exista, LexArchivo creara su carpeta y podras anadir documentos.</p> : <><div onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} className={`grid min-h-36 place-items-center rounded-lg border-2 border-dashed p-6 text-center transition ${dragging ? "border-acento bg-teal-50" : "border-linea bg-stone-50"}`}><div className="grid justify-items-center gap-2"><UploadCloud size={34} className="text-acento" /><p className="font-medium">Arrastra documentos aqui</p><p className="text-sm text-stone-600">Se guardaran con su mismo nombre en la carpeta del expediente.</p><div className="flex flex-wrap justify-center gap-2"><Button onClick={() => api.selectDocumentPaths().then(appendPaths)}>Seleccionar archivos</Button><Button onClick={openFolder}><FolderOpen size={17} />Abrir carpeta</Button></div></div></div><Field multiline label="Archivos preparados" value={paths} onChange={setPaths} /><div className="flex flex-wrap items-center gap-3"><Button tone="primary" onClick={() => addPrepared(false)}>Copiar a carpeta</Button><Button onClick={() => addPrepared(true)}>Mover a carpeta</Button>{message && <p className="text-sm text-stone-600">{message}</p>}</div></>}</div></section>;
}

function Notes({ full, reload }: { full: FullCase; reload: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return <section className="grid gap-4"><div className="rounded-lg border border-linea bg-white p-4"><Field label="Titulo" value={title} onChange={setTitle} /><Field multiline label="Nota" value={body} onChange={setBody} /><Button className="mt-3" tone="primary" onClick={() => api.addNote(full.expediente.id, { title, body }).then(reload)}>Crear nota</Button></div>{full.notes.map((note) => <article className="rounded-lg border border-linea bg-white p-4" key={note.id}><div className="flex justify-between"><h3 className="font-semibold">{note.title}</h3><span className="text-sm text-stone-600">{new Date(note.updated_at).toLocaleString("es-ES")}</span></div><p className="mt-2 whitespace-pre-wrap text-sm">{note.body}</p></article>)}</section>;
}

function ClientCasesView({ cases, onBack, onSelect, onNewCase }: { cases: ClientSummary[]; onBack: () => void; onSelect: (id: string) => void; onNewCase: () => void }) {
  const sorted = [...cases].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const name = sorted[0]?.name ?? "Cliente";
  return <main className="p-6"><button className="mb-2 text-sm text-acento" onClick={onBack}>Volver a clientes</button><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-semibold">{name}</h2><p className="text-sm text-stone-600">Expedientes asociados a este cliente.</p></div><Button tone="primary" onClick={onNewCase}><Plus size={18} />Nuevo expediente</Button></div><div className="overflow-hidden rounded-lg border border-linea bg-white"><table className="w-full border-collapse text-sm"><thead className="bg-stone-100 text-left"><tr>{["Expediente", "Tipo", "Estado", "Abogado responsable", "Ultima modificacion"].map((h) => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{sorted.map((item) => <tr key={item.case_id} className="cursor-pointer border-t border-linea hover:bg-stone-50" onClick={() => onSelect(item.case_id)}><td className="p-3 font-medium">{item.case_number}</td><td className="p-3">{item.matter_type}</td><td className="p-3">{item.status}</td><td className="p-3">{item.responsible_lawyer}</td><td className="p-3">{new Date(item.updated_at).toLocaleString("es-ES")}</td></tr>)}</tbody></table></div></main>;
}

function Backups() {
  const [message, setMessage] = useState("");
  return <main className="p-6"><h2 className="mb-2 text-2xl font-semibold">Copias de seguridad</h2><p className="mb-5 rounded-md border border-aviso bg-amber-50 p-3 text-sm">Guarda una copia adicional en un disco externo. No sobrescribas tus copias antiguas.</p><div className="flex gap-2"><Button tone="primary" onClick={() => api.createBackup().then(setMessage)}>Crear copia manual</Button><Button onClick={() => api.openBackupsFolder()}>Abrir carpeta de copias</Button></div>{message && <p className="mt-4 text-sm">{message}</p>}</main>;
}

function SharedReadonlyFile({ shared, onBack }: { shared: SharedCasePackage; onBack: () => void }) {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Datos del cliente");
  const full = shared.case_data;
  const op = full.opposing_party;
  const sortedEvents = [...full.events].sort((a, b) => `${a.event_date} ${a.event_time}`.localeCompare(`${b.event_date} ${b.event_time}`));
  return (
    <main className="p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button className="mb-3 px-4 py-2 text-base" onClick={onBack}>Volver</Button>
          <h2 className="text-2xl font-semibold">{full.client.name || "Cliente compartido"}</h2>
          <p className="text-sm text-stone-600">{full.expediente.case_number || "Sin numero de expediente"}</p>
        </div>
        <Button onClick={() => api.openSharedCaseFolder(shared.id)}><FolderOpen size={17} />Abrir carpeta</Button>
      </div>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-linea">{tabs.map((item) => <button className={`focus-ring rounded-t-md px-3 py-2 text-sm ${tab === item ? "bg-white font-semibold" : "hover:bg-white/70"}`} onClick={() => setTab(item)} key={item}>{item}</button>)}</div>
      {tab === "Datos del cliente" && <div className="grid gap-4 md:grid-cols-2"><ReadOnlyField label="Nombre y apellidos o razon social" value={full.client.name} /><ReadOnlyField label="DNI, NIE o CIF" value={full.client.tax_id} /><ReadOnlyField label="Telefono" value={full.client.phone} /><ReadOnlyField label="Email" value={full.client.email} /><ReadOnlyField label="Direccion" value={full.client.address} /><ReadOnlyField label="Fecha de alta" value={full.client.registration_date} /><div className="md:col-span-2"><ReadOnlyField multiline label="Observaciones" value={full.client.observations} /></div></div>}
      {tab === "Expediente" && <div className="grid gap-4 md:grid-cols-2"><ReadOnlyField label="Tipo de asunto" value={full.expediente.matter_type} /><ReadOnlyField label="Jurisdiccion" value={full.expediente.jurisdiction} /><ReadOnlyField label="Estado" value={full.expediente.status} /><ReadOnlyField label="Abogado responsable" value={full.expediente.responsible_lawyer} /><ReadOnlyField label="Fecha de apertura" value={full.expediente.opened_at} /><ReadOnlyField label="Fecha de cierre" value={full.expediente.closed_at} /><ReadOnlyField label="Proximo plazo relevante" value={full.expediente.next_deadline} /><div className="md:col-span-2"><ReadOnlyField multiline label="Descripcion" value={full.expediente.description} /></div></div>}
      {tab === "Parte contraria" && <div className="grid gap-4 md:grid-cols-2"><ReadOnlyField label="Nombre" value={op?.name} /><ReadOnlyField label="DNI/CIF" value={op?.tax_id} /><ReadOnlyField label="Telefono" value={op?.phone} /><ReadOnlyField label="Email" value={op?.email} /><ReadOnlyField label="Direccion" value={op?.address} /><ReadOnlyField label="Abogado contrario" value={op?.opposing_lawyer} /><ReadOnlyField label="Despacho del abogado contrario" value={op?.opposing_firm} /><ReadOnlyField label="Telefono abogado" value={op?.opposing_lawyer_phone} /><ReadOnlyField label="Email abogado" value={op?.opposing_lawyer_email} /></div>}
      {tab === "Cronologia" && <section className="grid gap-4">{sortedEvents.map((event) => <article key={event.id} className={`rounded-lg border p-4 ${event.event_type === "plazo" ? "border-aviso bg-amber-50" : "border-linea bg-white"}`}><div className="flex justify-between gap-3"><div><h3 className="font-semibold">{event.title}</h3><span className="text-sm">{event.event_date}{event.event_time ? ` ${event.event_time}` : ""} - {event.event_type}</span></div></div>{event.description && <p className="mt-2 text-sm text-stone-700">{event.description}</p>}</article>)}{sortedEvents.length === 0 && <p className="rounded-lg border border-linea bg-white p-4 text-sm text-stone-600">No hay entradas en la cronologia.</p>}</section>}
      {tab === "Documentos" && <section className="grid gap-3 rounded-lg border border-linea bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-stone-600">Los documentos compartidos se abren desde la carpeta del expediente.</p><Button onClick={() => api.openSharedCaseFolder(shared.id)}><FolderOpen size={17} />Abrir carpeta</Button></div>{full.documents.map((doc) => <article className="rounded-md border border-linea bg-stone-50 p-3 text-sm" key={doc.id}><p className="font-medium">{doc.original_name}</p>{doc.note && <p className="mt-1 text-stone-600">{doc.note}</p>}</article>)}{full.documents.length === 0 && <p className="text-sm text-stone-600">No hay documentos registrados.</p>}</section>}
      {tab === "Notas internas" && <section className="grid gap-4">{full.notes.map((note) => <article className="rounded-lg border border-linea bg-white p-4" key={note.id}><div className="flex justify-between"><h3 className="font-semibold">{note.title}</h3><span className="text-sm text-stone-600">{new Date(note.updated_at).toLocaleString("es-ES")}</span></div><p className="mt-2 whitespace-pre-wrap text-sm">{note.body}</p></article>)}{full.notes.length === 0 && <p className="rounded-lg border border-linea bg-white p-4 text-sm text-stone-600">No hay notas internas.</p>}</section>}
    </main>
  );
}

function SharedUseView({ privateCases, onOpenSettings }: { privateCases: ClientSummary[]; onOpenSettings: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [items, setItems] = useState<SharedCaseSummary[]>([]);
  const [selectedShared, setSelectedShared] = useState<SharedCasePackage | null>(null);
  const [selectedEditable, setSelectedEditable] = useState<FullCase | null>(null);
  const [setupMode, setSetupMode] = useState<"idle" | "create" | "join">("idle");
  const [syncName, setSyncName] = useState("Uso Compartido LexArchivo");
  const [joinCode, setJoinCode] = useState("");
  const [showPublishPanel, setShowPublishPanel] = useState(false);
  const [publishQuery, setPublishQuery] = useState("");
  const [selectedCases, setSelectedCases] = useState<string[]>([]);
  const [loadingShared, setLoadingShared] = useState(false);
  const [hasLoadedShared, setHasLoadedShared] = useState(false);
  const [message, setMessage] = useState("");
  const load = async () => {
    const nextSettings = await api.getSettings();
    setSettings(nextSettings);
    if (nextSettings.sync_name) setSyncName(nextSettings.sync_name);
  };
  const refreshShared = async () => {
    setLoadingShared(true);
    try {
      setItems(await api.listSharedCases());
      setHasLoadedShared(true);
    } catch (error) {
      setItems([]);
      setMessage(error instanceof Error ? error.message : "Configura la carpeta de Uso Compartido.");
    } finally {
      setLoadingShared(false);
    }
  };
  useEffect(() => { load(); }, []);
  const publishOptions = privateCases.filter((item) => {
    const query = publishQuery.trim().toLowerCase();
    if (!query) return true;
    return `${item.name} ${item.case_number} ${item.matter_type} ${item.responsible_lawyer}`.toLowerCase().includes(query);
  });
  function togglePublishCase(caseId: string) {
    setSelectedCases((current) => current.includes(caseId) ? current.filter((id) => id !== caseId) : [...current, caseId]);
  }
  async function publishSelected() {
    if (selectedCases.length === 0) {
      setMessage("Elige al menos un expediente para subir.");
      return;
    }
    for (const caseId of selectedCases) {
      await api.publishSharedCase(caseId);
    }
    setMessage(selectedCases.length === 1 ? "Expediente subido a Uso Compartido." : "Expedientes subidos a Uso Compartido.");
    setSelectedCases([]);
    setShowPublishPanel(false);
    await refreshShared();
  }
  async function confirmAndPublishCase(caseId: string) {
    const local = await api.getFullCase(caseId);
    const shared = await api.getSharedCase(caseId);
    const changes = describeCaseChanges(shared.case_data, local);
    const detail = changes.length > 0 ? changes.slice(0, 14).join("\n") : "No se han detectado cambios de datos. Se actualizara la fecha de publicacion.";
    if (!confirm(`Vas a actualizar este expediente en Uso Compartido.\n\nCambios detectados:\n${detail}\n\nContinuar?`)) return;
    await api.publishSharedCase(caseId);
    setMessage("Publicacion actualizada.");
    await refreshShared();
  }
  async function openShared(item: SharedCaseSummary) {
    if (item.can_edit) {
      setSelectedEditable(await api.getFullCase(item.id));
      return;
    }
    setSelectedShared(await api.getSharedCase(item.id));
  }
  async function createSync() {
    if (!syncName.trim()) {
      setMessage("Pon un nombre para el Uso Compartido.");
      return;
    }
    const status = await api.createLexArchivoSync(syncName.trim());
    setSettings(await api.getSettings());
    setMessage(status.message);
    await load();
  }
  async function joinSync() {
    if (!joinCode.trim()) {
      setMessage("Introduce el codigo de Uso Compartido.");
      return;
    }
    const status = await api.joinLexArchivoSync(joinCode.trim());
    setSettings(await api.getSettings());
    setMessage(status.message);
    await load();
  }
  if (!settings) return <main className="p-6">Cargando Uso Compartido...</main>;
  if (selectedEditable) {
    return (
      <ClientFile
        full={selectedEditable}
        knownClients={privateCases}
        onBack={() => setSelectedEditable(null)}
        onSaved={(saved) => {
          if (saved) {
            setSelectedEditable(saved);
          } else {
            api.getFullCase(selectedEditable.expediente.id).then(setSelectedEditable);
          }
        }}
        onDeleted={() => { setSelectedEditable(null); refreshShared(); }}
        onClientsChanged={() => undefined}
        stayAfterSave
        onSharedPublished={refreshShared}
      />
    );
  }
  if (selectedShared) {
    return <SharedReadonlyFile shared={selectedShared} onBack={() => setSelectedShared(null)} />;
  }
  if (!settings.sync_role) {
    return (
      <main className="grid gap-5 p-6">
        <div>
          <h2 className="text-2xl font-semibold">Uso Compartido</h2>
          <p className="text-sm text-stone-600">Crea un espacio compartido o unete con el codigo del administrador.</p>
        </div>
        <section className="grid gap-4 rounded-lg border border-linea bg-white p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <button className="rounded-lg border border-linea bg-stone-50 p-5 text-left hover:border-acento" onClick={() => setSetupMode("join")}>
              <p className="text-lg font-semibold">Unirse a Uso Compartido</p>
              <p className="mt-1 text-sm text-stone-600">Introduce el codigo que te dara el administrador.</p>
            </button>
            <button className="rounded-lg border border-linea bg-stone-50 p-5 text-left hover:border-acento" onClick={() => setSetupMode("create")}>
              <p className="text-lg font-semibold">Crear Uso Compartido</p>
              <p className="mt-1 text-sm text-stone-600">Crea un nuevo espacio y convierte este ordenador en administrador.</p>
            </button>
          </div>
          {setupMode === "create" && (
            <div className="grid gap-3 rounded-md border border-linea bg-stone-50 p-4">
              <Field label="Nombre del Uso Compartido" value={syncName} onChange={setSyncName} />
              <Button tone="primary" onClick={createSync}><Share2 size={17} />Crear Uso Compartido</Button>
            </div>
          )}
          {setupMode === "join" && (
            <div className="grid gap-3 rounded-md border border-linea bg-stone-50 p-4">
              <Field label="Codigo de Uso Compartido" value={joinCode} onChange={setJoinCode} />
              <p className="text-xs text-stone-600">La contrasena se anadira en una version futura.</p>
              <Button tone="primary" onClick={joinSync}><Share2 size={17} />Unirme</Button>
            </div>
          )}
          {message && <p className="text-sm text-acento">{message}</p>}
        </section>
      </main>
    );
  }
  return (
    <main className="grid gap-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{settings.sync_name || "Uso Compartido"}</h2>
          <p className="text-sm text-stone-600">Publica expedientes usando LexArchivo Sync como zona comun entre ordenadores.</p>
        </div>
        <div className="flex gap-2">
          {settings.sync_role === "admin" && <Button onClick={onOpenSettings}><Settings size={17} />Ajustes</Button>}
          <Button tone="primary" onClick={() => setShowPublishPanel(!showPublishPanel)}><Share2 size={17} />Subir expedientes</Button>
          <Button disabled={loadingShared} onClick={refreshShared}><RefreshCw size={17} />{loadingShared ? "Actualizando..." : "Actualizar"}</Button>
        </div>
      </div>
      {showPublishPanel && (
        <section className="grid gap-3 rounded-lg border border-linea bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Subir expedientes</h3>
              <p className="text-sm text-stone-600">Selecciona uno o varios expedientes privados para publicarlos en Uso Compartido.</p>
            </div>
            <Button tone="primary" onClick={publishSelected}><Share2 size={17} />Subir seleccionados</Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 text-stone-400" size={18} />
            <input className="focus-ring w-full rounded-md border border-linea bg-white py-2 pl-10 pr-3" placeholder="Buscar por cliente, expediente, tipo o abogado" value={publishQuery} onChange={(event) => setPublishQuery(event.target.value)} />
          </div>
          <div className="max-h-80 overflow-auto rounded-md border border-linea">
            {publishOptions.map((item) => (
              <label key={item.case_id} className="flex cursor-pointer items-center gap-3 border-b border-linea p-3 text-sm last:border-b-0 hover:bg-stone-50">
                <input type="checkbox" checked={selectedCases.includes(item.case_id)} onChange={() => togglePublishCase(item.case_id)} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{item.name}</span>
                  <span className="block text-xs text-stone-600">{item.case_number} - {item.matter_type} - {item.responsible_lawyer || "Sin abogado"}</span>
                </span>
              </label>
            ))}
            {publishOptions.length === 0 && <p className="p-4 text-sm text-stone-600">No hay expedientes que coincidan con la busqueda.</p>}
          </div>
          {selectedCases.length > 0 && <p className="text-sm text-acento">{selectedCases.length} seleccionado{selectedCases.length === 1 ? "" : "s"}.</p>}
        </section>
      )}
      <section className="grid gap-4 rounded-lg border border-linea bg-white p-4">
        {!settings.user_name && <p className="rounded-md border border-aviso bg-amber-50 p-3 text-sm text-stone-700">Configura tu nombre en Ajustes para que los expedientes compartidos indiquen quien los publica.</p>}
        {!settings.shared_dir && <p className="rounded-md border border-aviso bg-amber-50 p-3 text-sm text-stone-700">Crea o unete a un Uso Compartido para preparar la carpeta LexArchivo Sync.</p>}
        {message && <p className="text-sm text-acento">{message}</p>}
      </section>
      <section className="overflow-hidden rounded-lg border border-linea bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-stone-100 text-left"><tr>{["Cliente", "Expediente", "Tipo", "Estado", "Propietario", "Modificado", "Acciones"].map((header) => <th className="p-3" key={header}>{header}</th>)}</tr></thead>
          <tbody>
            {items.map((item) => <tr key={item.id} className="border-t border-linea"><td className="p-3 font-medium">{item.client_name}</td><td className="p-3">{item.case_number}</td><td className="p-3">{item.matter_type}</td><td className="p-3">{item.status}</td><td className="p-3">{item.owner_name}{item.can_edit ? " (tuyo)" : ""}</td><td className="p-3">{new Date(item.modified_at).toLocaleString("es-ES")}</td><td className="flex gap-2 p-3"><Button onClick={() => openShared(item)}>Ver</Button>{item.can_edit && <Button onClick={() => confirmAndPublishCase(item.id)}>Actualizar publicacion</Button>}</td></tr>)}
          </tbody>
        </table>
        {items.length === 0 && <p className="p-4 text-sm text-stone-600">{hasLoadedShared ? "Todavia no hay expedientes compartidos." : "Pulsa Actualizar para cargar los expedientes compartidos."}</p>}
      </section>
    </main>
  );
}

function DeletedCasesView({ onReload }: { onReload: () => void }) {
  const [items, setItems] = useState<ClientSummary[]>([]);
  const [message, setMessage] = useState("");
  const loadDeleted = () => api.listDeletedCases().then(setItems);
  useEffect(() => { loadDeleted(); }, []);
  async function restore(caseId: string) {
    await api.restoreCase(caseId);
    setMessage("Expediente recuperado.");
    await loadDeleted();
    onReload();
  }
  async function purge(caseId: string) {
    if (!confirm("Esta accion borrara definitivamente el expediente. ¿Continuar?")) return;
    if (!confirm("Confirmacion final: no podras recuperarlo despues.")) return;
    await api.purgeDeletedCase(caseId);
    setMessage("Expediente borrado definitivamente.");
    await loadDeleted();
    onReload();
  }
  return <main className="p-6"><h2 className="mb-2 text-2xl font-semibold">Recien eliminado</h2><p className="mb-5 text-sm text-stone-600">Los expedientes se conservan durante 30 dias antes de eliminarse automaticamente.</p>{message && <p className="mb-4 text-sm text-acento">{message}</p>}<div className="overflow-hidden rounded-lg border border-linea bg-white"><table className="w-full border-collapse text-sm"><thead className="bg-stone-100 text-left"><tr>{["Cliente", "Expediente", "Tipo", "Eliminado", "Acciones"].map((h) => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.case_id} className="border-t border-linea"><td className="p-3 font-medium">{item.name}</td><td className="p-3">{item.case_number}</td><td className="p-3">{item.matter_type}</td><td className="p-3">{new Date(item.updated_at).toLocaleString("es-ES")}</td><td className="flex gap-2 p-3"><Button onClick={() => restore(item.case_id)}>Recuperar</Button><Button tone="danger" onClick={() => purge(item.case_id)}>Borrar definitivo</Button></td></tr>)}</tbody></table>{items.length === 0 && <p className="p-4 text-sm text-stone-600">No hay expedientes eliminados.</p>}</div></main>;
}

function SyncSettingsBlock({ settings, onSaved }: { settings: AppSettings; onSaved: (settings: AppSettings) => void }) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncName, setSyncName] = useState(settings.sync_name || "Uso Compartido LexArchivo");
  const [localMessage, setLocalMessage] = useState("");

  useEffect(() => {
    setSyncName(settings.sync_name || "Uso Compartido LexArchivo");
  }, [settings.sync_name]);

  useEffect(() => {
    api.getSyncStatus().then(setSyncStatus).catch(() => setSyncStatus(null));
  }, []);

  async function saveSharedSettings() {
    const next = await api.saveSettings({ sync_name: syncName });
    onSaved(next);
    setLocalMessage("Ajustes de Uso Compartido guardados.");
  }

  return (
    <section className="grid gap-3 rounded-lg border border-linea bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-acento">Uso Compartido</p>
          <h3 className="text-lg font-semibold">{settings.sync_name || "Uso Compartido no configurado"}</h3>
          <p className="text-sm text-stone-600">Codigo, nombre y estado del motor de sincronizacion.</p>
        </div>
        {settings.sync_role === "admin" && <Button onClick={saveSharedSettings}><Save size={17} />Guardar</Button>}
      </div>
      {settings.sync_role === "admin" ? (
        <>
          <Field label="Nombre del Uso Compartido" value={syncName} onChange={setSyncName} />
          <p className="break-all rounded-md border border-linea bg-stone-50 p-3 text-sm"><b>Codigo:</b> {settings.sync_code || syncStatus?.device_id || "Todavia no disponible"}</p>
          <p className="text-xs text-stone-600">En una version futura aqui se configurara la contrasena y los permisos del Uso Compartido.</p>
        </>
      ) : settings.sync_role === "member" ? (
        <p className="break-all rounded-md border border-linea bg-stone-50 p-3 text-sm"><b>Codigo usado para unirse:</b> {settings.sync_code || "Todavia no disponible"}</p>
      ) : (
        <p className="rounded-md border border-linea bg-stone-50 p-3 text-sm text-stone-600">Todavia no has creado ni te has unido a ningun Uso Compartido.</p>
      )}
      <div className="grid gap-2 rounded-md border border-linea bg-stone-50 p-3">
        <p className="text-xs font-semibold uppercase text-acento">LexArchivo Sync experimental</p>
        <h4 className="text-base font-semibold">{syncStatus?.running ? "Motor activo" : syncStatus?.installed ? "Motor instalado" : "Motor no instalado"}</h4>
        <p className="text-sm text-stone-600">{syncStatus?.message ?? "Comprobando sincronizacion..."}</p>
        {syncStatus?.device_id && <p className="break-all text-xs text-stone-600"><b>ID de este ordenador:</b> {syncStatus.device_id}</p>}
        {syncStatus?.shared_dir && <p className="break-all text-xs text-stone-600"><b>Carpeta LexArchivo Sync:</b> {syncStatus.shared_dir}</p>}
        {syncStatus?.version && <p className="text-xs text-stone-500">{syncStatus.version}</p>}
      </div>
      {localMessage && <p className="text-sm text-acento">{localMessage}</p>}
    </section>
  );
}

function SettingsView({ onThemeChanged, onInactivityChanged, onNotificationChanged, onScaleChanged }: { onThemeChanged: (theme: "Claro" | "Oscuro") => void; onInactivityChanged: (minutes: number) => void; onNotificationChanged: (settings: AppSettings) => void; onScaleChanged: (scale: number) => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [message, setMessage] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [updating, setUpdating] = useState(false);
  useEffect(() => { api.getSettings().then(setSettings); }, []);
  if (!settings) return <main className="p-6">Cargando ajustes...</main>;

  async function runUpdater() {
    setUpdating(true);
    try {
      await checkDownloadAndInstallUpdate(setMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo completar la actualizacion.");
    } finally {
      setUpdating(false);
    }
  }

  async function createUsbRecovery() {
    try {
      setRecoveryMessage(await api.createUsbRecoveryFile());
    } catch (error) {
      setRecoveryMessage(error instanceof Error ? error.message : "No se pudo crear el USB de desbloqueo.");
    }
  }

  const notificationsEnabled = settings.notification_style !== "Desactivadas";
  const toggleNotifications = (enabled: boolean) => setSettings({ ...settings, notification_style: enabled ? "Sistema e interna" : "Desactivadas" });
  const saveAllSettings = () => api.saveSettings(settings).then((saved) => {
    setSettings(saved);
    onThemeChanged(saved.theme);
    onInactivityChanged(saved.inactivity_minutes);
    onNotificationChanged(saved);
    onScaleChanged(saved.ui_scale);
  });
  const testNotification = async () => {
    await sendSystemNotice({ id: "test", kind: "update", title: "LexArchivo", body: "Notificacion de prueba de Windows." }, () => undefined, notificationsEnabled);
    setMessage(notificationsEnabled ? "He enviado una notificacion de prueba." : "Activa las notificaciones antes de probar.");
  };

  return (
    <main className="grid gap-5 p-6">
      <h2 className="text-2xl font-semibold">Ajustes</h2>
      <div className="grid gap-3 rounded-lg border border-linea bg-white p-4">
        <Field label="Nombre de usuario" value={settings.user_name} onChange={(v) => setSettings({ ...settings, user_name: v })} />
        <Field label="Carpeta principal de datos" value={settings.data_dir} onChange={(v) => setSettings({ ...settings, data_dir: v })} />
        <label className="grid gap-1 text-sm"><span className="font-medium text-stone-700">Bloqueo por inactividad</span><select className="focus-ring rounded-md border border-linea bg-white px-3 py-2" value={String(settings.inactivity_minutes)} onChange={(e) => setSettings({ ...settings, inactivity_minutes: Number(e.target.value) })}><option value="5">5 minutos</option><option value="10">10 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option><option value="0">Ninguno</option></select></label>
        <label className="grid gap-1 text-sm"><span className="font-medium text-stone-700">Tema de la interfaz</span><select className="focus-ring rounded-md border border-linea bg-white px-3 py-2" value={settings.theme} onChange={(e) => { const theme = e.target.value as "Claro" | "Oscuro"; setSettings({ ...settings, theme }); onThemeChanged(theme); }}><option>Claro</option><option>Oscuro</option></select></label>
        <label className="grid gap-1 text-sm"><span className="font-medium text-stone-700">Tamano de la interfaz</span><select className="focus-ring rounded-md border border-linea bg-white px-3 py-2" value={String(settings.ui_scale)} onChange={(e) => { const ui_scale = Number(e.target.value); setSettings({ ...settings, ui_scale }); onScaleChanged(ui_scale); }}>{[50, 70, 80, 90, 100, 110, 120, 130, 140, 150].map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
        <div className="grid gap-2 rounded-md border border-linea bg-stone-50 p-3"><p className="text-sm font-semibold">Notificaciones</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notificationsEnabled} onChange={(e) => toggleNotifications(e.target.checked)} />Activar notificaciones</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!notificationsEnabled} checked={settings.app_notifications} onChange={(e) => setSettings({ ...settings, app_notifications: e.target.checked })} />Notificaciones de la app</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!notificationsEnabled} checked={settings.update_notifications} onChange={(e) => setSettings({ ...settings, update_notifications: e.target.checked })} />Notificaciones de ajustes</label><Button onClick={testNotification}>Probar notificacion</Button></div>
        <SyncSettingsBlock settings={settings} onSaved={setSettings} />
        <div className="rounded-md border border-linea bg-stone-50 p-3"><p className="text-sm font-semibold">USB de desbloqueo</p><p className="mt-1 text-sm text-stone-600">Crea una llave de emergencia en un USB. Solo se usara si la app queda bloqueada tras demasiados intentos fallidos.</p><Button className="mt-3" onClick={createUsbRecovery}><KeyRound size={17} />Crear USB de desbloqueo</Button>{recoveryMessage && <p className="mt-2 text-sm">{recoveryMessage}</p>}</div>
        <p className="text-sm"><b>Base de datos:</b> {settings.db_path}</p>
        <p className="text-sm"><b>Documentos:</b> {settings.documents_dir}</p>
        <p className="text-sm"><b>Copias:</b> {settings.backups_dir}</p>
        <p className="text-sm"><b>Version:</b> {settings.app_version}</p>
        <p className="text-sm text-stone-600">Las actualizaciones se buscan en GitHub Releases y se instalan solo si estan firmadas correctamente.</p>
        <div className="flex gap-2"><Button tone="primary" onClick={saveAllSettings}>Guardar ajustes</Button><Button disabled={updating} onClick={runUpdater}>{updating ? "Actualizando..." : "Buscar actualizaciones"}</Button></div>
      </div>
      {message && <p className="text-sm">{message}</p>}
    </main>
  );
}

function emptyCase(): FullCase {
  const now = new Date().toISOString();
  return { client: { id: "", name: "", tax_id: "", phone: "", email: "", address: "", registration_date: now.slice(0, 10), observations: "", created_at: now, updated_at: now }, expediente: { id: "", client_id: "", case_number: "", matter_type: "", jurisdiction: "", status: "Abierto", description: "", responsible_lawyer: "", opened_at: now.slice(0, 10), closed_at: "", next_deadline: "" }, opposing_party: null, events: [], documents: [], notes: [] };
}

export function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [view, setView] = useState<Vista>("Clientes");
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selected, setSelected] = useState<FullCase | null>(null);
  const [selectedClientCases, setSelectedClientCases] = useState<ClientSummary[] | null>(null);
  const [selectedTab, setSelectedTab] = useState<(typeof tabs)[number] | undefined>();
  const [highlightedEventId, setHighlightedEventId] = useState<string | undefined>();
  const [theme, setTheme] = useState<"Claro" | "Oscuro">("Claro");
  const [inactivityMinutes, setInactivityMinutes] = useState(10);
  const [uiScale, setUiScale] = useState(100);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [appNotifications, setAppNotifications] = useState(true);
  const [updateNotifications, setUpdateNotifications] = useState(true);
  const [lastUpdateNotice, setLastUpdateNotice] = useState("");
  const load = () => api.listClients().then(setClients);
  useEffect(() => { if (unlocked) { load(); api.getSettings().then((settings) => { setTheme(settings.theme); setInactivityMinutes(settings.inactivity_minutes); setUiScale(settings.ui_scale); setNotificationsEnabled(settings.notification_style !== "Desactivadas"); setAppNotifications(settings.app_notifications); setUpdateNotifications(settings.update_notifications); }); } }, [unlocked]);
  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * (uiScale / 100)}px`;
    return () => { document.documentElement.style.fontSize = ""; };
  }, [uiScale]);
  useEffect(() => {
    if (!unlocked || inactivityMinutes <= 0) return;
    let timer: number | undefined;
    const lock = () => {
      setSelected(null);
      setSelectedClientCases(null);
      setUnlocked(false);
    };
    const reset = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(lock, inactivityMinutes * 60 * 1000);
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    reset();
    return () => {
      if (timer) window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [unlocked, inactivityMinutes]);
  async function newCaseForSelectedClient() {
    if (!selectedClientCases?.[0]) return;
    const existing = await api.getFullCase(selectedClientCases[0].case_id);
    const draft = emptyCase();
    draft.client = existing.client;
    draft.expediente.client_id = existing.client.id;
    setSelected(draft);
    setSelectedClientCases(null);
  }
  async function openNotice(notice: AppNotice) {
    if (notice.kind === "update") {
      setSelected(null);
      setSelectedClientCases(null);
      setView("Ajustes");
      return;
    }
    if (notice.caseId) {
      const full = await api.getFullCase(notice.caseId);
      setSelectedClientCases(null);
      setSelectedTab("Cronologia");
      setHighlightedEventId(notice.eventId);
      setSelected(full);
    }
  }
  function pushNotice(notice: AppNotice) {
    sendSystemNotice(notice, () => openNotice(notice), notificationsEnabled);
  }
  useEffect(() => {
    if (!unlocked || !notificationsEnabled || !appNotifications) return;
    let stopped = false;
    async function checkTimeline() {
      const pending = await api.listPendingNotifications();
      if (stopped) return;
      pending.forEach((item: PendingNotification) => pushNotice({ id: `event-${item.id}`, kind: "event", title: item.title, body: `${item.client_name} · ${item.case_number} · ${item.event_date} ${item.event_time}`, caseId: item.case_id, eventId: item.id }));
    }
    checkTimeline();
    const timer = window.setInterval(checkTimeline, 60000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [unlocked, notificationsEnabled, appNotifications]);
  useEffect(() => {
    if (!unlocked || !notificationsEnabled || !updateNotifications) return;
    let stopped = false;
    async function checkUpdateNotice() {
      try {
        const message = await api.checkUpdates();
        if (stopped || !message.startsWith("Hay una nueva version disponible") || message === lastUpdateNotice) return;
        setLastUpdateNotice(message);
        pushNotice({ id: `update-${Date.now()}`, kind: "update", title: "Actualizacion disponible", body: message });
      } catch {
        // La comprobacion silenciosa no debe molestar si no hay conexion.
      }
    }
    checkUpdateNotice();
    const timer = window.setInterval(checkUpdateNotice, 10 * 60 * 1000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [unlocked, notificationsEnabled, updateNotifications, lastUpdateNotice]);
  if (!unlocked) return <AccessScreen onUnlocked={() => setUnlocked(true)} />;
  const activeClients = clients.filter((client) => client.status !== "Archivado" && client.status !== "Cerrado");
  const archivedClients = clients.filter((client) => client.status === "Archivado" || client.status === "Cerrado");
  return (
    <div className={theme === "Oscuro" ? "theme-dark" : ""}>
      <Shell view={view} setView={(v) => { setSelected(null); setSelectedClientCases(null); setSelectedTab(undefined); setHighlightedEventId(undefined); setView(v); }}>
        {selected ? (
          <ClientFile full={selected} knownClients={clients} initialTab={selectedTab} highlightedEventId={highlightedEventId} onBack={() => { setSelected(null); setSelectedTab(undefined); setHighlightedEventId(undefined); }} onDeleted={() => { setSelected(null); setSelectedTab(undefined); setHighlightedEventId(undefined); load(); }} onClientsChanged={load} onSaved={(saved) => { load(); if (saved) setSelected(saved); else if (selected.expediente.id) api.getFullCase(selected.expediente.id).then(setSelected); }} />
        ) : selectedClientCases ? (
          <ClientCasesView cases={selectedClientCases} onBack={() => setSelectedClientCases(null)} onNewCase={newCaseForSelectedClient} onSelect={(id) => api.getFullCase(id).then(setSelected)} />
        ) : view === "Copias de seguridad" ? (
          <Backups />
        ) : view === "Uso Compartido" ? (
          <SharedUseView privateCases={activeClients} onOpenSettings={() => setView("Ajustes")} />
        ) : view === "Recien eliminado" ? (
          <DeletedCasesView onReload={load} />
        ) : view === "Ajustes" ? (
          <SettingsView onThemeChanged={setTheme} onInactivityChanged={setInactivityMinutes} onScaleChanged={setUiScale} onNotificationChanged={(settings) => { setNotificationsEnabled(settings.notification_style !== "Desactivadas"); setAppNotifications(settings.app_notifications); setUpdateNotifications(settings.update_notifications); }} />
        ) : (
          <Dashboard mode={view} clients={view === "Archivados" ? archivedClients : activeClients} onNew={() => setSelected(emptyCase())} onSelect={(id) => api.getFullCase(id).then(setSelected)} onSelectClient={setSelectedClientCases} />
        )}
      </Shell>
    </div>
  );
}
