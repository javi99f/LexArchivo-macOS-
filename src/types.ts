export type EstadoExpediente = "Abierto" | "Pendiente" | "En juicio" | "Cerrado" | "Archivado";
export type TipoEvento = "llamada" | "reunion" | "cita cliente" | "escrito" | "notificacion" | "juicio" | "plazo" | "nota interna";

export interface AppSettings {
  user_name: string;
  shared_dir: string;
  sync_name: string;
  sync_code: string;
  sync_role: string;
  data_dir: string;
  db_path: string;
  documents_dir: string;
  backups_dir: string;
  inactivity_minutes: number;
  update_manifest_url: string;
  notification_style: "Solo interna" | "Sistema e interna" | "Desactivadas";
  app_notifications: boolean;
  update_notifications: boolean;
  ui_scale: number;
  theme: "Claro" | "Oscuro";
  app_version: string;
}

export interface LoginStatus {
  has_password: boolean;
  failed_attempts: number;
  locked_until: string;
  lockout_cycles: number;
  hard_locked: boolean;
  windows_hello_available: boolean;
}

export interface AuthResult {
  unlocked: boolean;
  message: string;
  locked_until: string;
  hard_locked: boolean;
}

export interface ClientSummary {
  client_id: string;
  case_id: string;
  name: string;
  case_number: string;
  matter_type: string;
  status: EstadoExpediente;
  responsible_lawyer: string;
  opened_at: string;
  updated_at: string;
}

export interface ClientDetail {
  id: string;
  name: string;
  tax_id: string;
  phone: string;
  email: string;
  address: string;
  registration_date: string;
  observations: string;
  created_at: string;
  updated_at: string;
}

export interface CaseDetail {
  id: string;
  client_id: string;
  case_number: string;
  matter_type: string;
  jurisdiction: string;
  status: EstadoExpediente;
  description: string;
  responsible_lawyer: string;
  opened_at: string;
  closed_at: string;
  next_deadline: string;
}

export interface OpposingParty {
  id: string;
  case_id: string;
  name: string;
  tax_id: string;
  phone: string;
  email: string;
  address: string;
  opposing_lawyer: string;
  opposing_firm: string;
  opposing_lawyer_phone: string;
  opposing_lawyer_email: string;
}

export interface TimelineEvent {
  id: string;
  case_id: string;
  event_date: string;
  event_time: string;
  title: string;
  description: string;
  event_type: TipoEvento;
  reminder_minutes: number;
}

export interface PendingNotification {
  id: string;
  case_id: string;
  client_name: string;
  case_number: string;
  title: string;
  event_date: string;
  event_time: string;
  event_type: string;
  reminder_minutes: number;
}

export interface DocumentRecord {
  id: string;
  case_id: string;
  original_name: string;
  internal_name: string;
  relative_path: string;
  document_date: string;
  file_type: string;
  note: string;
}

export interface InternalNote {
  id: string;
  case_id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface FullCase {
  client: ClientDetail;
  expediente: CaseDetail;
  opposing_party: OpposingParty | null;
  events: TimelineEvent[];
  documents: DocumentRecord[];
  notes: InternalNote[];
}

export interface UpsertClientRequest {
  client: Partial<ClientDetail> & Pick<ClientDetail, "name">;
  expediente: Partial<CaseDetail>;
  opposing_party?: Partial<OpposingParty>;
}

export interface SharedCaseSummary {
  id: string;
  owner_name: string;
  added_at: string;
  modified_by: string;
  modified_at: string;
  client_name: string;
  case_number: string;
  matter_type: string;
  status: EstadoExpediente;
  responsible_lawyer: string;
  can_edit: boolean;
}

export interface SharedCasePackage {
  id: string;
  owner_name: string;
  added_at: string;
  modified_by: string;
  modified_at: string;
  case_data: FullCase;
}

export interface SharedPublishStatus {
  published: boolean;
  can_edit: boolean;
  has_unpublished_changes: boolean;
  modified_at: string;
}

export interface SyncStatus {
  installed: boolean;
  running: boolean;
  version: string;
  device_id: string;
  program_path: string;
  config_path: string;
  shared_dir: string;
  message: string;
}
