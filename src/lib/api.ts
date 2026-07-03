import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, AuthResult, ClientSummary, FullCase, LoginStatus, PendingNotification, SharedCasePackage, SharedCaseSummary, SharedPublishStatus, SyncStatus, UpsertClientRequest } from "../types";

const isTauri = "__TAURI_INTERNALS__" in window;

const demoSummaries: ClientSummary[] = [
  {
    client_id: "demo-1",
    case_id: "case-1",
    name: "Marina Soler Rivas",
    case_number: "EXP-2026-001",
    matter_type: "Civil",
    status: "Abierto",
    responsible_lawyer: "Clara Vidal",
    opened_at: new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString()
  },
  {
    client_id: "demo-2",
    case_id: "case-2",
    name: "Talleres Norte SL",
    case_number: "EXP-2026-002",
    matter_type: "Laboral",
    status: "Pendiente",
    responsible_lawyer: "Diego Costa",
    opened_at: new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString()
  }
];

function demoFullCase(summary: ClientSummary): FullCase {
  return {
    client: {
      id: summary.client_id,
      name: summary.name,
      tax_id: "00000000T",
      phone: "600 000 000",
      email: "cliente@example.test",
      address: "Calle Mayor 1, Madrid",
      registration_date: new Date().toISOString().slice(0, 10),
      observations: "Datos de demostracion local.",
      created_at: summary.updated_at,
      updated_at: summary.updated_at
    },
    expediente: {
      id: summary.case_id,
      client_id: summary.client_id,
      case_number: summary.case_number,
      matter_type: summary.matter_type,
      jurisdiction: "Primera instancia",
      status: summary.status,
      description: "Expediente de demostracion.",
      responsible_lawyer: summary.responsible_lawyer,
      opened_at: new Date().toISOString().slice(0, 10),
      closed_at: "",
      next_deadline: new Date(Date.now() + 86400000 * 12).toISOString().slice(0, 10)
    },
    opposing_party: {
      id: "op-" + summary.case_id,
      case_id: summary.case_id,
      name: "Parte contraria demo",
      tax_id: "B00000000",
      phone: "911 000 000",
      email: "contrario@example.test",
      address: "Avenida Central 22",
      opposing_lawyer: "Ana Leal",
      opposing_firm: "Leal Abogados",
      opposing_lawyer_phone: "912 000 000",
      opposing_lawyer_email: "ana@example.test"
    },
    events: [
      {
        id: "ev-" + summary.case_id,
        case_id: summary.case_id,
        event_date: new Date().toISOString().slice(0, 10),
        title: "Apertura del expediente",
        event_time: "",
        description: "Registro inicial del asunto.",
        event_type: "nota interna",
        reminder_minutes: 0
      }
    ],
    documents: [],
    notes: []
  };
}

async function call<T>(command: string, args?: Record<string, unknown>, fallback?: T): Promise<T> {
  if (!isTauri) {
    if (fallback !== undefined) return fallback;
    throw new Error("Esta accion requiere ejecutar LexArchivo dentro de Tauri.");
  }
  return invoke<T>(command, args);
}

export const api = {
  hasMasterPassword: () => call<boolean>("has_master_password", {}, false),
  createMasterPassword: (password: string) => call<boolean>("create_master_password", { password }, true),
  verifyMasterPassword: (password: string) => call<boolean>("verify_master_password", { password }, true),
  getLoginStatus: () => call<LoginStatus>("get_login_status", {}, { has_password: false, failed_attempts: 0, locked_until: "", lockout_cycles: 0, hard_locked: false, windows_hello_available: false }),
  verifyAccessPassword: (password: string) => call<AuthResult>("verify_access_password", { password }, { unlocked: true, message: "", locked_until: "", hard_locked: false }),
  unlockWithWindowsHello: () => call<AuthResult>("unlock_with_windows_hello", {}, { unlocked: false, message: "Windows Hello no esta disponible en modo navegador.", locked_until: "", hard_locked: false }),
  createUsbRecoveryFile: () => call<string>("create_usb_recovery_file", {}, "Archivo de recuperacion simulado."),
  unlockWithUsbRecovery: () => call<AuthResult>("unlock_with_usb_recovery", {}, { unlocked: false, message: "Recuperacion USB no disponible en modo navegador.", locked_until: "", hard_locked: false }),
  changeMasterPassword: (currentPassword: string, newPassword: string) =>
    call<boolean>("change_master_password", { currentPassword, newPassword }, true),
  listClients: () => call<ClientSummary[]>("list_clients", {}, demoSummaries),
  getFullCase: (caseId: string) => {
    const summary = demoSummaries.find((item) => item.case_id === caseId) ?? demoSummaries[0];
    return call<FullCase>("get_full_case", { caseId }, demoFullCase(summary));
  },
  saveClientCase: (request: UpsertClientRequest) => call<FullCase>("save_client_case", { request }, demoFullCase(demoSummaries[0])),
  moveClientToTrash: (clientId: string) => call<boolean>("move_client_to_trash", { clientId }, true),
  addEvent: (caseId: string, event: Record<string, unknown>) => call<boolean>("add_event", { caseId, event }, true),
  removeEvent: (eventId: string) => call<boolean>("remove_event", { eventId }, true),
  listPendingNotifications: () => call<PendingNotification[]>("list_pending_notifications", {}, []),
  addNote: (caseId: string, note: Record<string, unknown>) => call<boolean>("add_note", { caseId, note }, true),
  addDocuments: (caseId: string, paths: string[], note: string, moveFiles = false) => call<boolean>("add_documents", { caseId, paths, note, moveFiles }, true),
  selectDocumentPaths: () => call<string[]>("select_document_paths", {}, []),
  selectSharedFolder: () => call<string>("select_shared_folder", {}, ""),
  removeDocument: (documentId: string, deleteFromDisk: boolean) =>
    call<boolean>("remove_document", { documentId, deleteFromDisk }, true),
  openDocumentFolder: (documentId: string) => call<boolean>("open_document_folder", { documentId }, true),
  openCaseDocumentsFolder: (caseId: string) => call<boolean>("open_case_documents_folder", { caseId }, true),
  getSyncStatus: () => call<SyncStatus>("get_sync_status", {}, { installed: false, running: false, version: "", device_id: "", program_path: "", config_path: "", shared_dir: "", message: "Syncthing no esta disponible en modo navegador." }),
  createLexArchivoSync: (name: string) => call<SyncStatus>("create_lexarchivo_sync", { name }, { installed: false, running: false, version: "", device_id: "", program_path: "", config_path: "", shared_dir: "", message: "Uso Compartido simulado en modo navegador." }),
  joinLexArchivoSync: (code: string) => call<SyncStatus>("join_lexarchivo_sync", { code }, { installed: false, running: false, version: "", device_id: "", program_path: "", config_path: "", shared_dir: "", message: "Union simulada en modo navegador." }),
  listSharedCases: () => call<SharedCaseSummary[]>("list_shared_cases", {}, []),
  publishSharedCase: (caseId: string) => call<boolean>("publish_shared_case", { caseId }, true),
  getSharedCase: (sharedId: string) => call<SharedCasePackage>("get_shared_case", { sharedId }, {
    id: "",
    owner_name: "Usuario",
    added_at: new Date().toISOString(),
    modified_by: "Usuario",
    modified_at: new Date().toISOString(),
    case_data: demoFullCase(demoSummaries[0])
  }),
  getSharedPublishStatus: (caseId: string) => call<SharedPublishStatus>("get_shared_publish_status", { caseId }, { published: false, can_edit: false, has_unpublished_changes: false, modified_at: "" }),
  openSharedCaseFolder: (sharedId: string) => call<boolean>("open_shared_case_folder", { sharedId }, true),
  archiveCase: (caseId: string) => call<boolean>("archive_case", { caseId }, true),
  restoreCase: (caseId: string) => call<boolean>("restore_case", { caseId }, true),
  createBackup: () => call<string>("create_backup", {}, "Copia simulada en modo navegador"),
  openBackupsFolder: () => call<boolean>("open_backups_folder", {}, true),
  loadDemoData: () => call<boolean>("load_demo_data", {}, true),
  clearDemoData: () => call<boolean>("clear_demo_data", {}, true),
  getSettings: () =>
    call<AppSettings>("get_settings", {}, {
      user_name: "",
      shared_dir: "",
      sync_name: "",
      sync_code: "",
      sync_role: "",
      data_dir: "Modo navegador",
      db_path: "Modo navegador",
      documents_dir: "Modo navegador",
      backups_dir: "Modo navegador",
      inactivity_minutes: 10,
      update_manifest_url: "",
      notification_style: "Sistema e interna",
      app_notifications: true,
      update_notifications: true,
      ui_scale: 100,
      theme: "Claro",
      app_version: "0.0.1"
    }),
  saveSettings: (settings: Partial<AppSettings>) => call<AppSettings>("save_settings", { settings }, settings as AppSettings),
  checkUpdates: () => call<string>("check_updates", {}, "No hay comprobacion remota configurada."),
  listDeletedCases: () => call<ClientSummary[]>("list_deleted_cases", {}, []),
  moveCaseToTrash: (caseId: string) => call<boolean>("move_case_to_trash", { caseId }, true),
  purgeDeletedCase: (caseId: string) => call<boolean>("purge_deleted_case", { caseId }, true)
};
