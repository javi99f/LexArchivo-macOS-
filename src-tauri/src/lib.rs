use argon2::{password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString}, Argon2};
use chrono::{Duration, Local, NaiveDateTime, TimeZone, Utc};
use rand_core::OsRng;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{env, fs, io::Write, path::{Path, PathBuf}, process::{Command, Stdio}, sync::Mutex, thread, time::Duration as StdDuration};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::{Manager, State};
use uuid::Uuid;
use walkdir::WalkDir;

const APP_VERSION: &str = "0.1.1";
const MIGRATION_001: &str = include_str!("../migrations/001_initial.sql");
const FAILED_ATTEMPTS_KEY: &str = "login_failed_attempts";
const LOCKED_UNTIL_KEY: &str = "login_locked_until";
const LOCKOUT_CYCLES_KEY: &str = "login_lockout_cycles";
const HARD_LOCKED_KEY: &str = "login_hard_locked";
const USB_RECOVERY_HASH_KEY: &str = "usb_recovery_hash";

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone)]
struct AppCore {
    data_dir: PathBuf,
    db_path: PathBuf,
    documents_dir: PathBuf,
    backups_dir: PathBuf,
}

type SharedCore = Mutex<AppCore>;

pub trait ClientRepository {
    fn list_clients(&self) -> Result<Vec<ClientSummary>, String>;
    fn save_client_case(&self, request: UpsertClientRequest) -> Result<FullCase, String>;
}

pub trait CaseRepository {
    fn get_full_case(&self, case_id: &str) -> Result<FullCase, String>;
    fn archive_case(&self, case_id: &str) -> Result<(), String>;
    fn restore_case(&self, case_id: &str) -> Result<(), String>;
}

pub trait DocumentStorageProvider {
    fn add_documents(&self, case_id: &str, paths: Vec<String>, note: String, move_files: bool) -> Result<(), String>;
}

pub trait BackupProvider {
    fn create_backup(&self) -> Result<PathBuf, String>;
}

// Futuro: SupabaseClientRepository y SupabaseDocumentStorageProvider podran implementar estos contratos.
// No hay conexion a nube en esta version.
struct SQLiteClientRepository<'a>(&'a AppCore);
struct SQLiteCaseRepository<'a>(&'a AppCore);
struct LocalDocumentStorageProvider<'a>(&'a AppCore);
struct LocalBackupProvider<'a>(&'a AppCore);

#[derive(Serialize, Deserialize, Clone)]
pub struct ClientSummary {
    client_id: String,
    case_id: String,
    name: String,
    case_number: String,
    matter_type: String,
    status: String,
    responsible_lawyer: String,
    opened_at: String,
    updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ClientDetail {
    id: String,
    name: String,
    tax_id: String,
    phone: String,
    email: String,
    address: String,
    registration_date: String,
    observations: String,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CaseDetail {
    id: String,
    client_id: String,
    case_number: String,
    matter_type: String,
    jurisdiction: String,
    status: String,
    description: String,
    responsible_lawyer: String,
    opened_at: String,
    closed_at: String,
    next_deadline: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct OpposingParty {
    id: String,
    case_id: String,
    name: String,
    tax_id: String,
    phone: String,
    email: String,
    address: String,
    opposing_lawyer: String,
    opposing_firm: String,
    opposing_lawyer_phone: String,
    opposing_lawyer_email: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TimelineEvent {
    id: String,
    case_id: String,
    event_date: String,
    event_time: String,
    title: String,
    description: String,
    event_type: String,
    reminder_minutes: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DocumentRecord {
    id: String,
    case_id: String,
    original_name: String,
    internal_name: String,
    relative_path: String,
    document_date: String,
    file_type: String,
    note: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct InternalNote {
    id: String,
    case_id: String,
    title: String,
    body: String,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FullCase {
    client: ClientDetail,
    expediente: CaseDetail,
    opposing_party: Option<OpposingParty>,
    events: Vec<TimelineEvent>,
    documents: Vec<DocumentRecord>,
    notes: Vec<InternalNote>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SharedCaseSummary {
    id: String,
    owner_name: String,
    added_at: String,
    modified_by: String,
    modified_at: String,
    client_name: String,
    case_number: String,
    matter_type: String,
    status: String,
    responsible_lawyer: String,
    can_edit: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SharedCasePackage {
    id: String,
    owner_name: String,
    added_at: String,
    modified_by: String,
    modified_at: String,
    case_data: FullCase,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SharedPublishStatus {
    published: bool,
    can_edit: bool,
    has_unpublished_changes: bool,
    modified_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct UpsertClientRequest {
    client: ClientDraft,
    expediente: CaseDraft,
    opposing_party: Option<OpposingDraft>,
}

#[derive(Serialize, Deserialize)]
pub struct ClientDraft {
    id: Option<String>,
    name: String,
    tax_id: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    address: Option<String>,
    registration_date: Option<String>,
    observations: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct CaseDraft {
    id: Option<String>,
    case_number: Option<String>,
    matter_type: Option<String>,
    jurisdiction: Option<String>,
    status: Option<String>,
    description: Option<String>,
    responsible_lawyer: Option<String>,
    opened_at: Option<String>,
    closed_at: Option<String>,
    next_deadline: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct OpposingDraft {
    id: Option<String>,
    name: Option<String>,
    tax_id: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    address: Option<String>,
    opposing_lawyer: Option<String>,
    opposing_firm: Option<String>,
    opposing_lawyer_phone: Option<String>,
    opposing_lawyer_email: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct EventDraft {
    event_date: String,
    event_time: Option<String>,
    title: String,
    description: Option<String>,
    event_type: String,
    reminder_minutes: Option<i64>,
}

#[derive(Serialize, Deserialize)]
pub struct NoteDraft {
    title: String,
    body: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AppSettings {
    user_name: String,
    shared_dir: String,
    sync_name: String,
    sync_code: String,
    sync_role: String,
    data_dir: String,
    db_path: String,
    documents_dir: String,
    backups_dir: String,
    inactivity_minutes: i64,
    update_manifest_url: String,
    notification_style: String,
    app_notifications: bool,
    update_notifications: bool,
    ui_scale: i64,
    theme: String,
    app_version: String,
}

#[derive(Serialize, Deserialize)]
pub struct SettingsPatch {
    user_name: Option<String>,
    shared_dir: Option<String>,
    sync_name: Option<String>,
    sync_code: Option<String>,
    sync_role: Option<String>,
    data_dir: Option<String>,
    inactivity_minutes: Option<i64>,
    update_manifest_url: Option<String>,
    notification_style: Option<String>,
    app_notifications: Option<bool>,
    update_notifications: Option<bool>,
    ui_scale: Option<i64>,
    theme: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncStatus {
    installed: bool,
    running: bool,
    version: String,
    device_id: String,
    program_path: String,
    config_path: String,
    shared_dir: String,
    message: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PendingNotification {
    id: String,
    case_id: String,
    client_name: String,
    case_number: String,
    title: String,
    event_date: String,
    event_time: String,
    event_type: String,
    reminder_minutes: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LoginStatus {
    has_password: bool,
    failed_attempts: i64,
    locked_until: String,
    lockout_cycles: i64,
    hard_locked: bool,
    windows_hello_available: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AuthResult {
    unlocked: bool,
    message: String,
    locked_until: String,
    hard_locked: bool,
}

impl AppCore {
    fn bootstrap(data_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        let documents_dir = data_dir.join("Documentos");
        let backups_dir = data_dir.join("Copias");
        fs::create_dir_all(&documents_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&backups_dir).map_err(|e| e.to_string())?;
        let core = Self { db_path: data_dir.join("lexarchivo.sqlite3"), data_dir, documents_dir, backups_dir };
        core.migrate_with_backup()?;
        core.purge_expired_deleted_cases()?;
        Ok(core)
    }

    fn conn(&self) -> Result<Connection, String> {
        let conn = Connection::open(&self.db_path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON;").map_err(|e| e.to_string())?;
        Ok(conn)
    }

    fn migrate_with_backup(&self) -> Result<(), String> {
        if self.db_path.exists() {
            let _ = LocalBackupProvider(self).create_backup();
        }
        let conn = self.conn()?;
        let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        if current < 1 {
            conn.execute_batch(MIGRATION_001).map_err(|e| e.to_string())?;
            conn.pragma_update(None, "user_version", 2).map_err(|e| e.to_string())?;
        }
        let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        if current < 2 {
            conn.execute_batch(
                "ALTER TABLE timeline_events ADD COLUMN event_time TEXT NOT NULL DEFAULT '';
                 ALTER TABLE timeline_events ADD COLUMN reminder_minutes INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE timeline_events ADD COLUMN reminder_sent_at TEXT;"
            ).map_err(|e| e.to_string())?;
            conn.pragma_update(None, "user_version", 2).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn purge_expired_deleted_cases(&self) -> Result<(), String> {
        let cutoff = (Utc::now() - Duration::days(30)).to_rfc3339();
        let conn = self.conn()?;
        let mut stmt = conn.prepare("SELECT id FROM cases WHERE deleted_at IS NOT NULL AND deleted_at < ?1").map_err(|e| e.to_string())?;
        let ids = stmt.query_map([cutoff], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        drop(stmt);
        for case_id in ids {
            purge_case_by_id(&conn, &case_id)?;
        }
        Ok(())
    }
}

fn now() -> String { Utc::now().to_rfc3339() }
fn today() -> String { Utc::now().date_naive().to_string() }
fn id() -> String { Uuid::new_v4().to_string() }
fn clean(value: Option<String>) -> String { value.unwrap_or_default().trim().to_string() }

fn validate_non_empty(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() { Err(format!("{field} es obligatorio.")) } else { Ok(()) }
}

fn next_case_number(conn: &Connection) -> Result<String, String> {
    let year = Utc::now().format("%Y").to_string();
    let count: i64 = conn.query_row("SELECT COUNT(*) + 1 FROM cases WHERE case_number LIKE ?1", [format!("EXP-{year}-%")], |row| row.get(0)).map_err(|e| e.to_string())?;
    Ok(format!("EXP-{year}-{:03}", count))
}

impl<'a> ClientRepository for SQLiteClientRepository<'a> {
    fn list_clients(&self) -> Result<Vec<ClientSummary>, String> {
        let conn = self.0.conn()?;
        let mut stmt = conn.prepare("SELECT clients.id, cases.id, clients.name, cases.case_number, cases.matter_type, cases.status, cases.responsible_lawyer, cases.opened_at, MAX(clients.updated_at, cases.updated_at) FROM clients JOIN cases ON cases.client_id = clients.id WHERE clients.deleted_at IS NULL AND cases.deleted_at IS NULL ORDER BY clients.updated_at DESC").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| Ok(ClientSummary { client_id: row.get(0)?, case_id: row.get(1)?, name: row.get(2)?, case_number: row.get(3)?, matter_type: row.get(4)?, status: row.get(5)?, responsible_lawyer: row.get(6)?, opened_at: row.get(7)?, updated_at: row.get(8)? })).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    fn save_client_case(&self, request: UpsertClientRequest) -> Result<FullCase, String> {
        validate_non_empty(&request.client.name, "El nombre")?;
        let conn = self.0.conn()?;
        let now = now();
        let client_id = request.client.id.filter(|v| !v.is_empty()).unwrap_or_else(id);
        conn.execute("INSERT INTO clients (id, name, tax_id, phone, email, address, registration_date, observations, created_at, updated_at, version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 1) ON CONFLICT(id) DO UPDATE SET name=excluded.name, tax_id=excluded.tax_id, phone=excluded.phone, email=excluded.email, address=excluded.address, registration_date=excluded.registration_date, observations=excluded.observations, updated_at=excluded.updated_at, version=version+1",
            params![client_id, request.client.name.trim(), clean(request.client.tax_id), clean(request.client.phone), clean(request.client.email), clean(request.client.address), request.client.registration_date.unwrap_or_else(today), clean(request.client.observations), now]).map_err(|e| e.to_string())?;
        let case_id = request.expediente.id.filter(|v| !v.is_empty()).unwrap_or_else(id);
        let case_number = match request.expediente.case_number.filter(|v| !v.is_empty()) { Some(n) => n, None => next_case_number(&conn)? };
        conn.execute("INSERT INTO cases (id, client_id, case_number, matter_type, jurisdiction, status, description, responsible_lawyer, opened_at, closed_at, next_deadline, created_at, updated_at, version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, 1) ON CONFLICT(id) DO UPDATE SET matter_type=excluded.matter_type, jurisdiction=excluded.jurisdiction, status=excluded.status, description=excluded.description, responsible_lawyer=excluded.responsible_lawyer, opened_at=excluded.opened_at, closed_at=excluded.closed_at, next_deadline=excluded.next_deadline, updated_at=excluded.updated_at, version=version+1",
            params![case_id, client_id, case_number, clean(request.expediente.matter_type), clean(request.expediente.jurisdiction), request.expediente.status.unwrap_or_else(|| "Abierto".to_string()), clean(request.expediente.description), clean(request.expediente.responsible_lawyer), request.expediente.opened_at.unwrap_or_else(today), clean(request.expediente.closed_at), clean(request.expediente.next_deadline), now]).map_err(|e| e.to_string())?;
        if let Some(op) = request.opposing_party {
            let op_id = op.id.filter(|v| !v.is_empty()).unwrap_or_else(id);
            conn.execute("INSERT INTO opposing_parties (id, case_id, name, tax_id, phone, email, address, opposing_lawyer, opposing_firm, opposing_lawyer_phone, opposing_lawyer_email, created_at, updated_at, version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, 1) ON CONFLICT(case_id) DO UPDATE SET name=excluded.name, tax_id=excluded.tax_id, phone=excluded.phone, email=excluded.email, address=excluded.address, opposing_lawyer=excluded.opposing_lawyer, opposing_firm=excluded.opposing_firm, opposing_lawyer_phone=excluded.opposing_lawyer_phone, opposing_lawyer_email=excluded.opposing_lawyer_email, updated_at=excluded.updated_at, version=version+1",
                params![op_id, case_id, clean(op.name), clean(op.tax_id), clean(op.phone), clean(op.email), clean(op.address), clean(op.opposing_lawyer), clean(op.opposing_firm), clean(op.opposing_lawyer_phone), clean(op.opposing_lawyer_email), now]).map_err(|e| e.to_string())?;
        }
        SQLiteCaseRepository(self.0).get_full_case(&case_id)
    }
}

fn list_deleted_case_summaries(conn: &Connection) -> Result<Vec<ClientSummary>, String> {
    let mut stmt = conn.prepare("SELECT clients.id, cases.id, clients.name, cases.case_number, cases.matter_type, cases.status, cases.responsible_lawyer, cases.opened_at, cases.deleted_at FROM clients JOIN cases ON cases.client_id = clients.id WHERE cases.deleted_at IS NOT NULL ORDER BY cases.deleted_at DESC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| Ok(ClientSummary { client_id: row.get(0)?, case_id: row.get(1)?, name: row.get(2)?, case_number: row.get(3)?, matter_type: row.get(4)?, status: row.get(5)?, responsible_lawyer: row.get(6)?, opened_at: row.get(7)?, updated_at: row.get(8)? })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

impl<'a> CaseRepository for SQLiteCaseRepository<'a> {
    fn get_full_case(&self, case_id: &str) -> Result<FullCase, String> {
        let conn = self.0.conn()?;
        let client = conn.query_row("SELECT clients.id, name, tax_id, phone, email, address, registration_date, observations, clients.created_at, clients.updated_at FROM clients JOIN cases ON cases.client_id = clients.id WHERE cases.id=?1", [case_id], |r| Ok(ClientDetail { id: r.get(0)?, name: r.get(1)?, tax_id: r.get(2)?, phone: r.get(3)?, email: r.get(4)?, address: r.get(5)?, registration_date: r.get(6)?, observations: r.get(7)?, created_at: r.get(8)?, updated_at: r.get(9)? })).map_err(|e| e.to_string())?;
        let expediente = conn.query_row("SELECT id, client_id, case_number, matter_type, jurisdiction, status, description, responsible_lawyer, opened_at, closed_at, next_deadline FROM cases WHERE id=?1", [case_id], |r| Ok(CaseDetail { id: r.get(0)?, client_id: r.get(1)?, case_number: r.get(2)?, matter_type: r.get(3)?, jurisdiction: r.get(4)?, status: r.get(5)?, description: r.get(6)?, responsible_lawyer: r.get(7)?, opened_at: r.get(8)?, closed_at: r.get(9)?, next_deadline: r.get(10)? })).map_err(|e| e.to_string())?;
        let opposing_party = conn.query_row("SELECT id, case_id, name, tax_id, phone, email, address, opposing_lawyer, opposing_firm, opposing_lawyer_phone, opposing_lawyer_email FROM opposing_parties WHERE case_id=?1 AND deleted_at IS NULL", [case_id], |r| Ok(OpposingParty { id: r.get(0)?, case_id: r.get(1)?, name: r.get(2)?, tax_id: r.get(3)?, phone: r.get(4)?, email: r.get(5)?, address: r.get(6)?, opposing_lawyer: r.get(7)?, opposing_firm: r.get(8)?, opposing_lawyer_phone: r.get(9)?, opposing_lawyer_email: r.get(10)? })).optional().map_err(|e| e.to_string())?;
        let events = query_vec(&conn, "SELECT id, case_id, event_date, event_time, title, description, event_type, reminder_minutes FROM timeline_events WHERE case_id=?1 AND deleted_at IS NULL ORDER BY event_date, event_time", case_id, |r| Ok(TimelineEvent { id: r.get(0)?, case_id: r.get(1)?, event_date: r.get(2)?, event_time: r.get(3)?, title: r.get(4)?, description: r.get(5)?, event_type: r.get(6)?, reminder_minutes: r.get(7)? }))?;
        let documents = query_vec(&conn, "SELECT id, case_id, original_name, internal_name, relative_path, document_date, file_type, note FROM documents WHERE case_id=?1 AND deleted_at IS NULL ORDER BY document_date DESC", case_id, |r| Ok(DocumentRecord { id: r.get(0)?, case_id: r.get(1)?, original_name: r.get(2)?, internal_name: r.get(3)?, relative_path: r.get(4)?, document_date: r.get(5)?, file_type: r.get(6)?, note: r.get(7)? }))?;
        let notes = query_vec(&conn, "SELECT id, case_id, title, body, created_at, updated_at FROM internal_notes WHERE case_id=?1 AND deleted_at IS NULL ORDER BY updated_at DESC", case_id, |r| Ok(InternalNote { id: r.get(0)?, case_id: r.get(1)?, title: r.get(2)?, body: r.get(3)?, created_at: r.get(4)?, updated_at: r.get(5)? }))?;
        Ok(FullCase { client, expediente, opposing_party, events, documents, notes })
    }

    fn archive_case(&self, case_id: &str) -> Result<(), String> {
        self.0.conn()?.execute("UPDATE cases SET status='Archivado', updated_at=?1, version=version+1 WHERE id=?2", params![now(), case_id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn restore_case(&self, case_id: &str) -> Result<(), String> {
        self.0.conn()?.execute("UPDATE cases SET status='Abierto', updated_at=?1, version=version+1 WHERE id=?2 AND status IN ('Archivado','Cerrado')", params![now(), case_id]).map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn query_vec<T, F>(conn: &Connection, sql: &str, case_id: &str, mapper: F) -> Result<Vec<T>, String>
where F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([case_id], mapper).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

impl<'a> DocumentStorageProvider for LocalDocumentStorageProvider<'a> {
    fn add_documents(&self, case_id: &str, paths: Vec<String>, note: String, move_files: bool) -> Result<(), String> {
        let conn = self.0.conn()?;
        let target_dir = case_documents_dir(self.0, case_id)?;
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
        for raw in paths {
            let source = PathBuf::from(raw.trim());
            if !source.is_absolute() || !source.is_file() { return Err("Solo se aceptan rutas absolutas a archivos existentes.".into()); }
            let original_name = source.file_name().and_then(|n| n.to_str()).ok_or("Nombre de archivo no valido")?.to_string();
            let extension = source.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();
            let destination = target_dir.join(&original_name);
            if destination.exists() {
                return Err(format!("Ya existe un archivo llamado {original_name} en la carpeta del expediente."));
            }
            if move_files {
                if fs::rename(&source, &destination).is_err() {
                    fs::copy(&source, &destination).map_err(|e| e.to_string())?;
                    fs::remove_file(&source).map_err(|e| e.to_string())?;
                }
            } else {
                fs::copy(&source, &destination).map_err(|e| e.to_string())?;
            }
            let relative_path = destination.strip_prefix(&self.0.data_dir).unwrap_or(&destination).to_string_lossy().to_string();
            conn.execute("INSERT INTO documents (id, case_id, original_name, internal_name, relative_path, document_date, file_type, note, created_at, updated_at, version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 1)", params![id(), case_id, original_name, original_name, relative_path, today(), extension, note, now()]).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

fn case_documents_dir(core: &AppCore, case_id: &str) -> Result<PathBuf, String> {
    let conn = core.conn()?;
    let (case_number, client_name): (String, String) = conn.query_row("SELECT cases.case_number, clients.name FROM cases JOIN clients ON clients.id=cases.client_id WHERE cases.id=?1", [case_id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
    Ok(core.documents_dir.join(sanitize_name(&client_name)).join(case_number))
}

impl<'a> BackupProvider for LocalBackupProvider<'a> {
    fn create_backup(&self) -> Result<PathBuf, String> {
        fs::create_dir_all(&self.0.backups_dir).map_err(|e| e.to_string())?;
        let stamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
        let dest = self.0.backups_dir.join(format!("LexArchivo-{stamp}"));
        fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        let db_backup = dest.join("lexarchivo.sqlite3");
        let conn = self.0.conn()?;
        conn.execute("VACUUM main INTO ?1", [db_backup.to_string_lossy().to_string()]).map_err(|e| e.to_string())?;
        copy_dir(&self.0.documents_dir, &dest.join("Documentos"))?;
        let metadata = serde_json::json!({ "app_version": APP_VERSION, "created_at": now() });
        fs::write(dest.join("metadata.json"), serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        Ok(dest)
    }
}

fn sanitize_name(value: &str) -> String {
    value.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '-' } else { c }).collect()
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    if !from.exists() { return Ok(()); }
    for entry in WalkDir::new(from) {
        let entry = entry.map_err(|e| e.to_string())?;
        let relative = entry.path().strip_prefix(from).map_err(|e| e.to_string())?;
        let dest = to.join(relative);
        if entry.file_type().is_dir() { fs::create_dir_all(&dest).map_err(|e| e.to_string())?; }
        else { if let Some(parent) = dest.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; } fs::copy(entry.path(), dest).map_err(|e| e.to_string())?; }
    }
    Ok(())
}

#[tauri::command]
fn has_master_password(core: State<SharedCore>) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let count: i64 = core.conn()?.query_row("SELECT COUNT(*) FROM security WHERE deleted_at IS NULL", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    Ok(count > 0)
}

#[tauri::command]
fn create_master_password(core: State<SharedCore>, password: String) -> Result<bool, String> {
    validate_non_empty(&password, "La contrasena")?;
    if password.len() < 8 { return Err("La contrasena debe tener al menos 8 caracteres.".into()); }
    let hash = hash_secret(&password)?;
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    conn.execute("DELETE FROM security", []).map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO security (id, password_hash, created_at, updated_at, version) VALUES (?1, ?2, ?3, ?3, 1)", params![id(), hash, now()]).map_err(|e| e.to_string())?;
    reset_login_lock(&conn)?;
    Ok(true)
}

#[tauri::command]
fn verify_master_password(core: State<SharedCore>, password: String) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    verify_password_with_core(&core, &password)
}

#[tauri::command]
fn get_login_status(core: State<SharedCore>) -> Result<LoginStatus, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    Ok(LoginStatus {
        has_password: has_password_with_conn(&conn)?,
        failed_attempts: setting_i64(&conn, FAILED_ATTEMPTS_KEY, 0)?,
        locked_until: get_setting(&conn, LOCKED_UNTIL_KEY)?.unwrap_or_default(),
        lockout_cycles: setting_i64(&conn, LOCKOUT_CYCLES_KEY, 0)?,
        hard_locked: setting_bool(&conn, HARD_LOCKED_KEY)?,
        windows_hello_available: windows_hello_available(),
    })
}

#[tauri::command]
fn verify_access_password(core: State<SharedCore>, password: String) -> Result<AuthResult, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    if setting_bool(&conn, HARD_LOCKED_KEY)? {
        return Ok(auth_result(false, "La app esta bloqueada por seguridad. Inserta el USB de desbloqueo.", "", true));
    }
    if let Some(until) = active_lock_until(&conn)? {
        return Ok(auth_result(false, &format!("Demasiados intentos fallidos. Espera hasta {until}."), &until, false));
    }
    if verify_password_with_core(&core, &password)? {
        reset_login_lock(&conn)?;
        return Ok(auth_result(true, "Acceso concedido.", "", false));
    }
    register_failed_attempt(&conn)
}

#[tauri::command]
fn unlock_with_windows_hello(core: State<SharedCore>) -> Result<AuthResult, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    if setting_bool(&conn, HARD_LOCKED_KEY)? {
        return Ok(auth_result(false, "La app esta bloqueada por seguridad. Solo se puede recuperar con el USB.", "", true));
    }
    if let Some(until) = active_lock_until(&conn)? {
        return Ok(auth_result(false, &format!("Demasiados intentos fallidos. Espera hasta {until}."), &until, false));
    }
    if !windows_hello_available() {
        return Ok(auth_result(false, "Windows Hello no esta disponible en este equipo.", "", false));
    }
    if windows_hello_verify()? {
        reset_login_lock(&conn)?;
        Ok(auth_result(true, "Acceso concedido con Windows Hello.", "", false))
    } else {
        Ok(auth_result(false, "Windows Hello no ha verificado la identidad.", "", false))
    }
}

#[tauri::command]
fn create_usb_recovery_file(core: State<SharedCore>) -> Result<String, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let drive = first_removable_drive()?.ok_or("Conecta un USB y vuelve a intentarlo.")?;
    let raw = Uuid::new_v4().simple().to_string().to_uppercase();
    let code = format!("LEX-{}-{}-{}-{}", &raw[0..4], &raw[4..8], &raw[8..12], &raw[12..16]);
    set_setting(&conn, USB_RECOVERY_HASH_KEY, &hash_secret(&code)?)?;
    let path = PathBuf::from(format!("{drive}\\LexArchivo-Desbloqueo.txt"));
    let content = format!("LexArchivo USB de desbloqueo\nNo compartas este archivo.\nCODE={code}\n");
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(format!("USB de desbloqueo creado en {}", path.to_string_lossy()))
}

#[tauri::command]
fn unlock_with_usb_recovery(core: State<SharedCore>) -> Result<AuthResult, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let Some(hash) = get_setting(&conn, USB_RECOVERY_HASH_KEY)? else {
        return Ok(auth_result(false, "Todavia no hay un USB de desbloqueo configurado.", "", true));
    };
    let drives = removable_drives()?;
    for drive in drives {
        let path = PathBuf::from(format!("{drive}\\LexArchivo-Desbloqueo.txt"));
        if !path.is_file() { continue; }
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let code = content.lines().find_map(|line| line.strip_prefix("CODE=")).unwrap_or("").trim();
        if !code.is_empty() && verify_secret(&hash, code) {
            reset_login_lock(&conn)?;
            return Ok(auth_result(true, "App desbloqueada con el USB de recuperacion.", "", false));
        }
    }
    Ok(auth_result(false, "No se ha encontrado un USB de desbloqueo valido.", "", true))
}

#[tauri::command]
fn change_master_password(core: State<SharedCore>, current_password: String, new_password: String) -> Result<bool, String> {
    {
        let locked = core.lock().map_err(|e| e.to_string())?;
        if !verify_password_with_core(&locked, &current_password)? { return Ok(false); }
    }
    create_master_password(core, new_password)
}

fn verify_password_with_core(core: &AppCore, password: &str) -> Result<bool, String> {
    let hash: Option<String> = core.conn()?.query_row("SELECT password_hash FROM security WHERE deleted_at IS NULL LIMIT 1", [], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    Ok(match hash { Some(hash) => verify_secret(&hash, password), None => false })
}

fn has_password_with_conn(conn: &Connection) -> Result<bool, String> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM security WHERE deleted_at IS NULL", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    Ok(count > 0)
}

fn hash_secret(secret: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default().hash_password(secret.as_bytes(), &salt).map_err(|e| e.to_string()).map(|hash| hash.to_string())
}

fn verify_secret(hash: &str, secret: &str) -> bool {
    PasswordHash::new(hash).ok().and_then(|parsed| Argon2::default().verify_password(secret.as_bytes(), &parsed).ok()).is_some()
}

fn setting_i64(conn: &Connection, key: &str, fallback: i64) -> Result<i64, String> {
    Ok(get_setting(conn, key)?.and_then(|value| value.parse().ok()).unwrap_or(fallback))
}

fn setting_bool(conn: &Connection, key: &str) -> Result<bool, String> {
    Ok(get_setting(conn, key)?.as_deref() == Some("1"))
}

fn auth_result(unlocked: bool, message: &str, locked_until: &str, hard_locked: bool) -> AuthResult {
    AuthResult { unlocked, message: message.to_string(), locked_until: locked_until.to_string(), hard_locked }
}

fn active_lock_until(conn: &Connection) -> Result<Option<String>, String> {
    let Some(value) = get_setting(conn, LOCKED_UNTIL_KEY)? else { return Ok(None); };
    if value.trim().is_empty() { return Ok(None); }
    let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&value) else { return Ok(None); };
    if parsed.with_timezone(&Utc) > Utc::now() { Ok(Some(value)) } else { set_setting(conn, LOCKED_UNTIL_KEY, "")?; Ok(None) }
}

fn reset_login_lock(conn: &Connection) -> Result<(), String> {
    set_setting(conn, FAILED_ATTEMPTS_KEY, "0")?;
    set_setting(conn, LOCKED_UNTIL_KEY, "")?;
    set_setting(conn, LOCKOUT_CYCLES_KEY, "0")?;
    set_setting(conn, HARD_LOCKED_KEY, "0")?;
    Ok(())
}

fn register_failed_attempt(conn: &Connection) -> Result<AuthResult, String> {
    let attempts = setting_i64(conn, FAILED_ATTEMPTS_KEY, 0)? + 1;
    if attempts < 3 {
        set_setting(conn, FAILED_ATTEMPTS_KEY, &attempts.to_string())?;
        return Ok(auth_result(false, &format!("La contrasena no es correcta. Intento {attempts} de 3."), "", false));
    }
    let cycles = setting_i64(conn, LOCKOUT_CYCLES_KEY, 0)? + 1;
    set_setting(conn, FAILED_ATTEMPTS_KEY, "0")?;
    set_setting(conn, LOCKOUT_CYCLES_KEY, &cycles.to_string())?;
    if cycles >= 3 {
        set_setting(conn, HARD_LOCKED_KEY, "1")?;
        return Ok(auth_result(false, "La app queda bloqueada por completo. Usa el USB de desbloqueo.", "", true));
    }
    let until = (Utc::now() + Duration::minutes(10)).to_rfc3339();
    set_setting(conn, LOCKED_UNTIL_KEY, &until)?;
    Ok(auth_result(false, "Demasiados intentos fallidos. La app queda bloqueada 10 minutos.", &until, false))
}

fn powershell_output(script: &str) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = script;
        Ok(String::new())
    }
}

fn removable_drives() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let output = powershell_output(r#"Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2" | ForEach-Object { $_.DeviceID }"#)?;
        Ok(output.lines().map(str::trim).filter(|line| !line.is_empty()).map(ToString::to_string).collect())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

fn first_removable_drive() -> Result<Option<String>, String> {
    Ok(removable_drives()?.into_iter().next())
}

fn windows_hello_available() -> bool {
    windows_hello_check().unwrap_or(false)
}

fn windows_hello_check() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$verifier = [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($operation, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait() | Out-Null
  $task.Result
}
$availability = Await ($verifier::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability,Windows.Security.Credentials.UI,ContentType=WindowsRuntime])
if ($availability.ToString() -eq 'Available') { 'OK' }
"#;
        Ok(powershell_output(script)?.contains("OK"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

fn windows_hello_verify() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$verifier = [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($operation, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait() | Out-Null
  $task.Result
}
$result = Await ($verifier::RequestVerificationAsync('Entrar en LexArchivo')) ([Windows.Security.Credentials.UI.UserConsentVerificationResult,Windows.Security.Credentials.UI,ContentType=WindowsRuntime])
if ($result.ToString() -eq 'Verified') { 'OK' }
"#;
        Ok(powershell_output(script)?.contains("OK"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
fn list_clients(core: State<SharedCore>) -> Result<Vec<ClientSummary>, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    SQLiteClientRepository(&core).list_clients()
}

#[tauri::command]
fn get_full_case(core: State<SharedCore>, case_id: String) -> Result<FullCase, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    SQLiteCaseRepository(&core).get_full_case(&case_id)
}

#[tauri::command]
fn save_client_case(core: State<SharedCore>, request: UpsertClientRequest) -> Result<FullCase, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    SQLiteClientRepository(&core).save_client_case(request)
}

#[tauri::command]
fn move_client_to_trash(core: State<SharedCore>, client_id: String) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let updated = conn
        .execute(
            "UPDATE cases SET deleted_at=?1, updated_at=?1, version=version+1 WHERE client_id=?2 AND deleted_at IS NULL",
            params![now(), client_id],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("No se ha encontrado ningun expediente activo para este cliente.".into());
    }
    Ok(true)
}

#[tauri::command]
fn add_event(core: State<SharedCore>, case_id: String, event: EventDraft) -> Result<bool, String> {
    validate_non_empty(&event.title, "El titulo")?;
    let core = core.lock().map_err(|e| e.to_string())?;
    let reminder_minutes = normalize_reminder_minutes(event.reminder_minutes.unwrap_or(0));
    core.conn()?.execute("INSERT INTO timeline_events (id, case_id, event_date, event_time, title, description, event_type, reminder_minutes, created_at, updated_at, version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 1)", params![id(), case_id, event.event_date, clean(event.event_time), event.title, clean(event.description), event.event_type, reminder_minutes, now()]).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn remove_event(core: State<SharedCore>, event_id: String) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    core.conn()?.execute("UPDATE timeline_events SET deleted_at=?1, updated_at=?1, version=version+1 WHERE id=?2", params![now(), event_id]).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn list_pending_notifications(core: State<SharedCore>) -> Result<Vec<PendingNotification>, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let mut stmt = conn.prepare(
        "SELECT timeline_events.id, cases.id, clients.name, cases.case_number, timeline_events.title, timeline_events.event_date, timeline_events.event_time, timeline_events.event_type, timeline_events.reminder_minutes
         FROM timeline_events
         JOIN cases ON cases.id=timeline_events.case_id
         JOIN clients ON clients.id=cases.client_id
         WHERE timeline_events.deleted_at IS NULL
           AND cases.deleted_at IS NULL
           AND timeline_events.reminder_minutes > 0
           AND timeline_events.reminder_sent_at IS NULL"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| Ok(PendingNotification {
        id: row.get(0)?,
        case_id: row.get(1)?,
        client_name: row.get(2)?,
        case_number: row.get(3)?,
        title: row.get(4)?,
        event_date: row.get(5)?,
        event_time: row.get(6)?,
        event_type: row.get(7)?,
        reminder_minutes: row.get(8)?,
    })).map_err(|e| e.to_string())?;
    let now = Local::now();
    let mut due = Vec::new();
    for row in rows {
        let item = row.map_err(|e| e.to_string())?;
        if notification_due(&item, now) {
            conn.execute("UPDATE timeline_events SET reminder_sent_at=?1, updated_at=?1, version=version+1 WHERE id=?2", params![now.to_rfc3339(), item.id]).map_err(|e| e.to_string())?;
            due.push(item);
        }
    }
    Ok(due)
}

#[tauri::command]
fn add_note(core: State<SharedCore>, case_id: String, note: NoteDraft) -> Result<bool, String> {
    validate_non_empty(&note.title, "El titulo")?;
    let core = core.lock().map_err(|e| e.to_string())?;
    core.conn()?.execute("INSERT INTO internal_notes (id, case_id, title, body, created_at, updated_at, version) VALUES (?1, ?2, ?3, ?4, ?5, ?5, 1)", params![id(), case_id, note.title, note.body, now()]).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn add_documents(core: State<SharedCore>, case_id: String, paths: Vec<String>, note: String, move_files: bool) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    LocalDocumentStorageProvider(&core).add_documents(&case_id, paths, note, move_files)?;
    Ok(true)
}

#[tauri::command]
fn select_document_paths() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Multiselect = $true
$dialog.Title = 'Seleccionar documentos'
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  $dialog.FileNames -join "`n"
}
"#;
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-STA", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        let paths = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .collect();
        Ok(paths)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
fn select_shared_folder() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Seleccionar carpeta de Uso Compartido'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  $dialog.SelectedPath
}
"#;
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-STA", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(String::new())
    }
}

#[tauri::command]
fn remove_document(core: State<SharedCore>, document_id: String, delete_from_disk: bool) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let path: Option<String> = conn.query_row("SELECT relative_path FROM documents WHERE id=?1", [&document_id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    conn.execute("UPDATE documents SET deleted_at=?1, updated_at=?1, version=version+1 WHERE id=?2", params![now(), document_id]).map_err(|e| e.to_string())?;
    if delete_from_disk {
        if let Some(path) = path {
            let full = core.data_dir.join(path);
            if full.starts_with(&core.data_dir) && full.is_file() { let _ = fs::remove_file(full); }
        }
    }
    Ok(true)
}

#[tauri::command]
fn open_document_folder(core: State<SharedCore>, document_id: String) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let path: String = conn.query_row("SELECT relative_path FROM documents WHERE id=?1 AND deleted_at IS NULL", [&document_id], |r| r.get(0)).map_err(|e| e.to_string())?;
    let full = core.data_dir.join(path);
    let folder = full.parent().ok_or("No se pudo localizar la carpeta del documento.")?;
    if !folder.starts_with(&core.data_dir) || !folder.is_dir() {
        return Err("La carpeta del documento no existe o no es accesible.".into());
    }
    #[cfg(target_os = "windows")]
    Command::new("explorer").arg(folder).spawn().map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn open_case_documents_folder(core: State<SharedCore>, case_id: String) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let folder = case_documents_dir(&core, &case_id)?;
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    Command::new("explorer").arg(&folder).spawn().map_err(|e| e.to_string())?;
    Ok(true)
}

fn current_user_name(conn: &Connection) -> Result<String, String> {
    Ok(get_setting(conn, "user_name")?.filter(|value| !value.trim().is_empty()).unwrap_or_else(|| "Usuario".to_string()))
}

fn shared_root(conn: &Connection) -> Result<PathBuf, String> {
    let value = get_setting(conn, "shared_dir")?.unwrap_or_default();
    if value.trim().is_empty() {
        return Err("Configura primero la carpeta de Uso Compartido en Ajustes.".into());
    }
    Ok(PathBuf::from(value))
}

fn safe_folder_name(value: &str) -> String {
    value.chars().map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '-' }).collect::<String>().trim_matches('-').to_string()
}

fn shared_case_dir(root: &Path, package_id: &str) -> PathBuf {
    root.join("Expedientes").join(safe_folder_name(package_id))
}

fn syncthing_program_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let bundled = env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().and_then(|macos| macos.parent()).map(|contents| contents.join("Resources").join("syncthing")))
            .filter(|path| path.is_file());
        if bundled.is_some() {
            return bundled;
        }
        let dev = env::current_dir().ok().map(|dir| dir.join("src-tauri").join("resources").join("syncthing")).filter(|path| path.is_file());
        if dev.is_some() {
            return dev;
        }
        return Some(PathBuf::from("/usr/local/bin/syncthing")).filter(|path| path.is_file())
            .or_else(|| Some(PathBuf::from("/opt/homebrew/bin/syncthing")).filter(|path| path.is_file()));
    }
    #[cfg(target_os = "windows")]
    {
    env::var("LOCALAPPDATA").ok().map(|base| PathBuf::from(base).join("Programs").join("Syncthing").join("syncthing.exe")).filter(|path| path.is_file())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        None
    }
}

fn syncthing_config_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        return env::var("HOME").ok().map(|home| PathBuf::from(home).join("Library").join("Application Support").join("Syncthing").join("config.xml")).filter(|path| path.is_file());
    }
    #[cfg(target_os = "windows")]
    {
    env::var("LOCALAPPDATA").ok().map(|base| PathBuf::from(base).join("Syncthing").join("config.xml")).filter(|path| path.is_file())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        None
    }
}

fn xml_between(text: &str, start: &str, end: &str) -> Option<String> {
    let from = text.find(start)? + start.len();
    let to = text[from..].find(end)? + from;
    Some(text[from..to].trim().to_string())
}

fn xml_attr(text: &str, tag_start: &str, attr: &str) -> Option<String> {
    let from = text.find(tag_start)?;
    let slice = &text[from..text[from..].find('>').map(|end| from + end).unwrap_or(text.len())];
    let needle = format!("{attr}=\"");
    let attr_from = slice.find(&needle)? + needle.len();
    let attr_to = slice[attr_from..].find('"')? + attr_from;
    Some(slice[attr_from..attr_to].to_string())
}

fn syncthing_api_key_and_device() -> Option<(String, String)> {
    let config = syncthing_config_path()?;
    let text = fs::read_to_string(config).ok()?;
    let api_key = xml_between(&text, "<apikey>", "</apikey>")?;
    let device_id = xml_attr(&text, "<device ", "id").unwrap_or_default();
    Some((api_key, device_id))
}

fn syncthing_version(program: &Path) -> String {
    let mut command = Command::new(program);
    command.arg("--version");
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command.output().ok().and_then(|output| {
        if output.status.success() {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            None
        }
    }).unwrap_or_default()
}

fn syncthing_running(api_key: &str) -> bool {
    reqwest::blocking::Client::new()
        .get("http://127.0.0.1:8384/rest/system/status")
        .header("X-API-Key", api_key)
        .send()
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

fn ensure_syncthing_running() -> bool {
    if let Some((api_key, _device_id)) = syncthing_api_key_and_device() {
        if syncthing_running(&api_key) {
            return true;
        }
    }
    let Some(program) = syncthing_program_path() else {
        return false;
    };
    let mut command = Command::new(program);
    command
        .arg("--no-browser")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let _ = command.spawn();
    for _ in 0..12 {
        thread::sleep(StdDuration::from_millis(500));
        if let Some((api_key, _device_id)) = syncthing_api_key_and_device() {
            if syncthing_running(&api_key) {
                return true;
            }
        }
    }
    false
}

fn add_lexarchivo_folder_to_syncthing(path: &Path, api_key: &str, device_ids: &[String]) -> Result<(), String> {
    let devices: Vec<serde_json::Value> = device_ids
        .iter()
        .filter(|id| !id.trim().is_empty())
        .map(|id| serde_json::json!({ "deviceID": id }))
        .collect();
    if devices.is_empty() {
        return Ok(());
    }
    let body = serde_json::json!({
        "id": "lexarchivo-sync",
        "label": "LexArchivo Sync",
        "path": path.to_string_lossy().to_string(),
        "type": "sendreceive",
        "devices": devices,
        "rescanIntervalS": 60,
        "fsWatcherEnabled": true,
        "fsWatcherDelayS": 10,
        "ignorePerms": false
    });
    let client = reqwest::blocking::Client::new();
    let response = client
        .put("http://127.0.0.1:8384/rest/config/folders/lexarchivo-sync")
        .header("X-API-Key", api_key)
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Syncthing no acepto la carpeta LexArchivo Sync: {}", response.status()));
    }
    let _ = client
        .post("http://127.0.0.1:8384/rest/system/restart")
        .header("X-API-Key", api_key)
        .send();
    Ok(())
}

fn add_syncthing_device(api_key: &str, device_id: &str, name: &str) -> Result<(), String> {
    if device_id.trim().is_empty() {
        return Err("El codigo de Uso Compartido esta vacio.".into());
    }
    let body = serde_json::json!({
        "deviceID": device_id.trim(),
        "name": name.trim(),
        "addresses": ["dynamic"],
        "compression": "metadata",
        "introducer": false,
        "skipIntroductionRemovals": false,
        "paused": false,
        "autoAcceptFolders": false
    });
    let response = reqwest::blocking::Client::new()
        .put(format!("http://127.0.0.1:8384/rest/config/devices/{}", device_id.trim()))
        .header("X-API-Key", api_key)
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Syncthing no acepto el ordenador remoto: {}", response.status()));
    }
    Ok(())
}

#[tauri::command]
fn get_sync_status(core: State<SharedCore>) -> Result<SyncStatus, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let shared_dir = get_setting(&conn, "shared_dir")?.unwrap_or_default();
    let program = syncthing_program_path();
    let config = syncthing_config_path();
    let installed = program.is_some();
    let version = program.as_ref().map(|path| syncthing_version(path)).unwrap_or_default();
    let _ = ensure_syncthing_running();
    let (running, device_id) = syncthing_api_key_and_device()
        .map(|(api_key, device_id)| (syncthing_running(&api_key), device_id))
        .unwrap_or((false, String::new()));
    let message = if !installed {
        "Syncthing no esta instalado.".to_string()
    } else if !running {
        "Syncthing esta instalado, pero no responde todavia.".to_string()
    } else {
        "LexArchivo puede usar Syncthing como motor auxiliar.".to_string()
    };
    Ok(SyncStatus {
        installed,
        running,
        version,
        device_id,
        program_path: program.map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
        config_path: config.map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
        shared_dir,
        message,
    })
}

#[tauri::command]
fn create_lexarchivo_sync(core: State<SharedCore>, name: String) -> Result<SyncStatus, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let root = core.data_dir.join("LexArchivo Sync");
    fs::create_dir_all(root.join("Expedientes")).map_err(|e| e.to_string())?;
    set_setting(&conn, "shared_dir", &root.to_string_lossy())?;
    set_setting(&conn, "sync_name", name.trim())?;
    set_setting(&conn, "sync_role", "admin")?;
    let _ = ensure_syncthing_running();
    if let Some((api_key, device_id)) = syncthing_api_key_and_device() {
        set_setting(&conn, "sync_code", &device_id)?;
        if syncthing_running(&api_key) {
            add_lexarchivo_folder_to_syncthing(&root, &api_key, &[device_id.clone()])?;
        }
    }
    let program = syncthing_program_path();
    let config = syncthing_config_path();
    let installed = program.is_some();
    let version = program.as_ref().map(|path| syncthing_version(path)).unwrap_or_default();
    let (running, device_id) = syncthing_api_key_and_device()
        .map(|(api_key, device_id)| (syncthing_running(&api_key), device_id))
        .unwrap_or((false, String::new()));
    Ok(SyncStatus {
        installed,
        running,
        version,
        device_id,
        program_path: program.map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
        config_path: config.map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
        shared_dir: root.to_string_lossy().to_string(),
        message: "Uso Compartido creado.".to_string(),
    })
}

#[tauri::command]
fn join_lexarchivo_sync(core: State<SharedCore>, code: String) -> Result<SyncStatus, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let remote_code = code.trim().to_string();
    if remote_code.is_empty() {
        return Err("Introduce el codigo de Uso Compartido.".into());
    }
    let root = core.data_dir.join("LexArchivo Sync");
    fs::create_dir_all(root.join("Expedientes")).map_err(|e| e.to_string())?;
    set_setting(&conn, "shared_dir", &root.to_string_lossy())?;
    set_setting(&conn, "sync_code", &remote_code)?;
    set_setting(&conn, "sync_role", "member")?;
    if get_setting(&conn, "sync_name")?.unwrap_or_default().trim().is_empty() {
        set_setting(&conn, "sync_name", "Uso Compartido")?;
    }
    let _ = ensure_syncthing_running();
    if let Some((api_key, device_id)) = syncthing_api_key_and_device() {
        if syncthing_running(&api_key) {
            add_syncthing_device(&api_key, &remote_code, "Administrador LexArchivo")?;
            add_lexarchivo_folder_to_syncthing(&root, &api_key, &[device_id.clone(), remote_code.clone()])?;
        }
    }
    let program = syncthing_program_path();
    let config = syncthing_config_path();
    let installed = program.is_some();
    let version = program.as_ref().map(|path| syncthing_version(path)).unwrap_or_default();
    let (running, device_id) = syncthing_api_key_and_device()
        .map(|(api_key, device_id)| (syncthing_running(&api_key), device_id))
        .unwrap_or((false, String::new()));
    Ok(SyncStatus {
        installed,
        running,
        version,
        device_id,
        program_path: program.map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
        config_path: config.map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
        shared_dir: root.to_string_lossy().to_string(),
        message: "Solicitud de union preparada. El administrador tendra que aceptar este ordenador.".to_string(),
    })
}

fn read_shared_package(path: &Path) -> Result<SharedCasePackage, String> {
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_shared_cases(core: State<SharedCore>) -> Result<Vec<SharedCaseSummary>, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let current_user = current_user_name(&conn)?;
    let root = shared_root(&conn)?;
    let cases_dir = root.join("Expedientes");
    if !cases_dir.exists() {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    for entry in fs::read_dir(cases_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata_path = entry.path().join("expediente.json");
        if !metadata_path.is_file() {
            continue;
        }
        let package = read_shared_package(&metadata_path)?;
        items.push(SharedCaseSummary {
            id: package.id.clone(),
            owner_name: package.owner_name.clone(),
            added_at: package.added_at.clone(),
            modified_by: package.modified_by.clone(),
            modified_at: package.modified_at.clone(),
            client_name: package.case_data.client.name.clone(),
            case_number: package.case_data.expediente.case_number.clone(),
            matter_type: package.case_data.expediente.matter_type.clone(),
            status: package.case_data.expediente.status.clone(),
            responsible_lawyer: package.case_data.expediente.responsible_lawyer.clone(),
            can_edit: package.owner_name == current_user,
        });
    }
    items.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(items)
}

#[tauri::command]
fn publish_shared_case(core: State<SharedCore>, case_id: String) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let user_name = current_user_name(&conn)?;
    let root = shared_root(&conn)?;
    fs::create_dir_all(root.join("Expedientes")).map_err(|e| e.to_string())?;
    let full = SQLiteCaseRepository(&core).get_full_case(&case_id)?;
    let package_id = full.expediente.id.clone();
    let target_dir = shared_case_dir(&root, &package_id);
    let docs_dir = target_dir.join("documentos");
    fs::create_dir_all(&docs_dir).map_err(|e| e.to_string())?;
    for doc in &full.documents {
        let source = core.data_dir.join(&doc.relative_path);
        if source.is_file() {
            let destination = docs_dir.join(&doc.original_name);
            fs::copy(source, destination).map_err(|e| e.to_string())?;
        }
    }
    let metadata_path = target_dir.join("expediente.json");
    let existing = if metadata_path.is_file() { read_shared_package(&metadata_path).ok() } else { None };
    if let Some(package) = &existing {
        if package.owner_name != user_name {
            return Err("Este expediente compartido pertenece a otro usuario.".into());
        }
    }
    let timestamp = now();
    let package = SharedCasePackage {
        id: package_id,
        owner_name: existing.as_ref().map(|item| item.owner_name.clone()).unwrap_or_else(|| user_name.clone()),
        added_at: existing.as_ref().map(|item| item.added_at.clone()).unwrap_or_else(|| timestamp.clone()),
        modified_by: user_name,
        modified_at: timestamp,
        case_data: full,
    };
    let text = serde_json::to_string_pretty(&package).map_err(|e| e.to_string())?;
    fs::write(metadata_path, text).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn get_shared_case(core: State<SharedCore>, shared_id: String) -> Result<SharedCasePackage, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let root = shared_root(&conn)?;
    read_shared_package(&shared_case_dir(&root, &shared_id).join("expediente.json"))
}

#[tauri::command]
fn get_shared_publish_status(core: State<SharedCore>, case_id: String) -> Result<SharedPublishStatus, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let current_user = current_user_name(&conn)?;
    let root = match shared_root(&conn) {
        Ok(root) => root,
        Err(_) => {
            return Ok(SharedPublishStatus {
                published: false,
                can_edit: false,
                has_unpublished_changes: false,
                modified_at: String::new(),
            })
        }
    };
    let metadata_path = shared_case_dir(&root, &case_id).join("expediente.json");
    if !metadata_path.is_file() {
        return Ok(SharedPublishStatus {
            published: false,
            can_edit: false,
            has_unpublished_changes: false,
            modified_at: String::new(),
        });
    }
    let package = read_shared_package(&metadata_path)?;
    let local = SQLiteCaseRepository(&core).get_full_case(&case_id).ok();
    let has_unpublished_changes = if let Some(local) = local {
        serde_json::to_value(local).map_err(|e| e.to_string())? != serde_json::to_value(&package.case_data).map_err(|e| e.to_string())?
    } else {
        false
    };
    Ok(SharedPublishStatus {
        published: true,
        can_edit: package.owner_name == current_user,
        has_unpublished_changes,
        modified_at: package.modified_at,
    })
}

#[tauri::command]
fn open_shared_case_folder(core: State<SharedCore>, shared_id: String) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let root = shared_root(&conn)?;
    let folder = shared_case_dir(&root, &shared_id);
    if !folder.is_dir() {
        return Err("No se encontro la carpeta compartida del expediente.".into());
    }
    #[cfg(target_os = "windows")]
    Command::new("explorer").arg(&folder).spawn().map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn list_deleted_cases(core: State<SharedCore>) -> Result<Vec<ClientSummary>, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    list_deleted_case_summaries(&conn)
}

#[tauri::command]
fn move_case_to_trash(core: State<SharedCore>, case_id: String) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    core.conn()?.execute("UPDATE cases SET deleted_at=?1, updated_at=?1, version=version+1 WHERE id=?2 AND deleted_at IS NULL", params![now(), case_id]).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn purge_deleted_case(core: State<SharedCore>, case_id: String) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let deleted_at: Option<String> = conn.query_row("SELECT deleted_at FROM cases WHERE id=?1", [&case_id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    if deleted_at.is_none() {
        return Err("Solo se pueden borrar definitivamente expedientes que estan en Recien eliminado.".into());
    }
    purge_case_by_id(&conn, &case_id)?;
    Ok(true)
}

fn purge_case_by_id(conn: &Connection, case_id: &str) -> Result<(), String> {
    let client_id: String = conn.query_row("SELECT client_id FROM cases WHERE id=?1", [case_id], |r| r.get(0)).map_err(|e| e.to_string())?;
    for table in ["opposing_parties", "timeline_events", "documents", "internal_notes"] {
        conn.execute(&format!("DELETE FROM {table} WHERE case_id=?1"), [case_id]).map_err(|e| e.to_string())?;
    }
    conn.execute("DELETE FROM cases WHERE id=?1", [case_id]).map_err(|e| e.to_string())?;
    let remaining: i64 = conn.query_row("SELECT COUNT(*) FROM cases WHERE client_id=?1", [&client_id], |r| r.get(0)).map_err(|e| e.to_string())?;
    if remaining == 0 {
        conn.execute("DELETE FROM clients WHERE id=?1", [client_id]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn archive_case(core: State<SharedCore>, case_id: String) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    SQLiteCaseRepository(&core).archive_case(&case_id)?;
    Ok(true)
}

#[tauri::command]
fn restore_case(core: State<SharedCore>, case_id: String) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    core.conn()?.execute("UPDATE cases SET deleted_at=NULL, status='Abierto', updated_at=?1, version=version+1 WHERE id=?2", params![now(), case_id]).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn create_backup(core: State<SharedCore>) -> Result<String, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    Ok(LocalBackupProvider(&core).create_backup()?.to_string_lossy().to_string())
}

#[tauri::command]
fn open_backups_folder(core: State<SharedCore>) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer").arg(&core.backups_dir).spawn().map_err(|e| e.to_string())?;
    Ok(true)
}

fn read_app_settings(core: &AppCore, conn: &Connection) -> Result<AppSettings, String> {
    let inactivity_minutes = normalize_inactivity(get_setting(conn, "inactivity_minutes")?.and_then(|v| v.parse().ok()).unwrap_or(10));
    let update_manifest_url = get_setting(conn, "update_manifest_url")?.unwrap_or_default();
    let notification_style = normalize_notification_style(get_setting(conn, "notification_style")?.unwrap_or_else(|| "Sistema e interna".to_string()));
    let app_notifications = get_setting(conn, "app_notifications")?.map(|value| value != "0").unwrap_or(true);
    let update_notifications = get_setting(conn, "update_notifications")?.map(|value| value != "0").unwrap_or(true);
    let ui_scale = normalize_ui_scale(get_setting(conn, "ui_scale")?.and_then(|v| v.parse().ok()).unwrap_or(100));
    let theme = get_setting(conn, "theme")?.unwrap_or_else(|| "Claro".to_string());
    let user_name = get_setting(conn, "user_name")?.unwrap_or_default();
    let shared_dir = get_setting(conn, "shared_dir")?.unwrap_or_default();
    let sync_name = get_setting(conn, "sync_name")?.unwrap_or_default();
    let sync_code = get_setting(conn, "sync_code")?.unwrap_or_default();
    let sync_role = get_setting(conn, "sync_role")?.unwrap_or_default();
    Ok(AppSettings {
        user_name,
        shared_dir,
        sync_name,
        sync_code,
        sync_role,
        data_dir: core.data_dir.to_string_lossy().to_string(),
        db_path: core.db_path.to_string_lossy().to_string(),
        documents_dir: core.documents_dir.to_string_lossy().to_string(),
        backups_dir: core.backups_dir.to_string_lossy().to_string(),
        inactivity_minutes,
        update_manifest_url,
        notification_style,
        app_notifications,
        update_notifications,
        ui_scale,
        theme,
        app_version: APP_VERSION.to_string(),
    })
}

#[tauri::command]
fn get_settings(core: State<SharedCore>) -> Result<AppSettings, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    read_app_settings(&core, &conn)
}

#[tauri::command]
fn save_settings(core: State<SharedCore>, settings: SettingsPatch) -> Result<AppSettings, String> {
    let mut core = core.lock().map_err(|e| e.to_string())?;
    if let Some(new_dir) = settings.data_dir.filter(|v| !v.trim().is_empty()) {
        let new_core = AppCore::bootstrap(PathBuf::from(new_dir))?;
        *core = new_core;
    }
    let conn = core.conn()?;
    if let Some(name) = settings.user_name { set_setting(&conn, "user_name", name.trim())?; }
    if let Some(dir) = settings.shared_dir { set_setting(&conn, "shared_dir", dir.trim())?; }
    if let Some(name) = settings.sync_name { set_setting(&conn, "sync_name", name.trim())?; }
    if let Some(code) = settings.sync_code { set_setting(&conn, "sync_code", code.trim())?; }
    if let Some(role) = settings.sync_role { set_setting(&conn, "sync_role", role.trim())?; }
    if let Some(minutes) = settings.inactivity_minutes { set_setting(&conn, "inactivity_minutes", &normalize_inactivity(minutes).to_string())?; }
    if let Some(url) = settings.update_manifest_url { set_setting(&conn, "update_manifest_url", &url)?; }
    if let Some(style) = settings.notification_style { set_setting(&conn, "notification_style", &normalize_notification_style(style))?; }
    if let Some(enabled) = settings.app_notifications { set_setting(&conn, "app_notifications", if enabled { "1" } else { "0" })?; }
    if let Some(enabled) = settings.update_notifications { set_setting(&conn, "update_notifications", if enabled { "1" } else { "0" })?; }
    if let Some(scale) = settings.ui_scale { set_setting(&conn, "ui_scale", &normalize_ui_scale(scale).to_string())?; }
    if let Some(theme) = settings.theme.filter(|value| value == "Claro" || value == "Oscuro") { set_setting(&conn, "theme", &theme)?; }
    read_app_settings(&core, &conn)
}

#[tauri::command]
fn check_updates(core: State<SharedCore>) -> Result<String, String> {
    let settings = get_settings(core)?;
    if settings.update_manifest_url.trim().is_empty() { return Ok("No hay un JSON remoto de actualizaciones configurado.".into()); }
    let json: serde_json::Value = reqwest::blocking::get(settings.update_manifest_url).map_err(|e| e.to_string())?.json().map_err(|e| e.to_string())?;
    let latest = json.get("version").and_then(|v| v.as_str()).unwrap_or(APP_VERSION);
    let url = json.get("download_url").and_then(|v| v.as_str()).unwrap_or("");
    if latest > APP_VERSION { Ok(format!("Hay una nueva version disponible: {latest}. Descarga: {url}")) } else { Ok("No hay actualizaciones disponibles.".into()) }
}

fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0)).optional().map_err(|e| e.to_string())
}

fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, value]).map_err(|e| e.to_string())?;
    Ok(())
}

fn normalize_inactivity(minutes: i64) -> i64 {
    match minutes {
        0 | 5 | 10 | 30 | 60 => minutes,
        _ => 10,
    }
}

fn normalize_notification_style(value: String) -> String {
    match value.as_str() {
        "Solo interna" | "Sistema e interna" | "Desactivadas" => value,
        _ => "Sistema e interna".to_string(),
    }
}

fn normalize_ui_scale(value: i64) -> i64 {
    match value {
        50 | 70 | 80 | 90 | 100 | 110 | 120 | 130 | 140 | 150 => value,
        _ => 100,
    }
}

fn normalize_reminder_minutes(minutes: i64) -> i64 {
    match minutes {
        0 | 5 | 10 | 20 | 30 | 60 | 120 | 1440 => minutes,
        _ => 10,
    }
}

fn notification_due(item: &PendingNotification, now: chrono::DateTime<Local>) -> bool {
    if item.event_time.trim().is_empty() {
        return false;
    }
    let value = format!("{} {}", item.event_date, item.event_time);
    let Ok(local) = NaiveDateTime::parse_from_str(&value, "%Y-%m-%d %H:%M") else {
        return false;
    };
    let Some(event_at) = Local.from_local_datetime(&local).single() else {
        return false;
    };
    let notify_at = event_at - Duration::minutes(item.reminder_minutes);
    now >= notify_at && now <= event_at + Duration::hours(24)
}

#[tauri::command]
fn load_demo_data(core: State<SharedCore>) -> Result<bool, String> {
    let repo_core = core.lock().map_err(|e| e.to_string())?;
    let repo = SQLiteClientRepository(&repo_core);
    for (name, matter, lawyer) in [("Marina Soler Rivas", "Civil", "Clara Vidal"), ("Talleres Norte SL", "Laboral", "Diego Costa"), ("Hector Marin Lozano", "Penal", "Clara Vidal")] {
        let full = repo.save_client_case(UpsertClientRequest { client: ClientDraft { id: None, name: name.into(), tax_id: Some("00000000T".into()), phone: Some("600 000 000".into()), email: Some("cliente@example.test".into()), address: Some("Calle Mayor 1".into()), registration_date: Some(today()), observations: Some("Cliente ficticio de demostracion.".into()) }, expediente: CaseDraft { id: None, case_number: None, matter_type: Some(matter.into()), jurisdiction: Some("Primera instancia".into()), status: Some("Abierto".into()), description: Some("Expediente de demostracion.".into()), responsible_lawyer: Some(lawyer.into()), opened_at: Some(today()), closed_at: None, next_deadline: Some(today()) }, opposing_party: None })?;
        repo_core.conn()?.execute("UPDATE clients SET is_demo=1 WHERE id=?1", [&full.client.id]).map_err(|e| e.to_string())?;
        repo_core.conn()?.execute("UPDATE cases SET is_demo=1 WHERE id=?1", [&full.expediente.id]).map_err(|e| e.to_string())?;
        let mut fake = fs::File::create(repo_core.documents_dir.join(format!("documento-simulado-{}.txt", full.expediente.case_number))).map_err(|e| e.to_string())?;
        writeln!(fake, "Documento simulado para {}", full.expediente.case_number).map_err(|e| e.to_string())?;
        drop(fake);
        repo_core.conn()?.execute("INSERT INTO timeline_events (id, case_id, event_date, title, description, event_type, created_at, updated_at, version) VALUES (?1, ?2, ?3, 'Apertura del expediente', 'Evento ficticio de demostracion', 'nota interna', ?4, ?4, 1)", params![id(), full.expediente.id, today(), now()]).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
fn clear_demo_data(core: State<SharedCore>) -> Result<bool, String> {
    let core = core.lock().map_err(|e| e.to_string())?;
    let conn = core.conn()?;
    let stamp = now();
    conn.execute("UPDATE clients SET deleted_at=?1 WHERE is_demo=1", [&stamp]).map_err(|e| e.to_string())?;
    conn.execute("UPDATE cases SET deleted_at=?1 WHERE is_demo=1", [&stamp]).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let core = AppCore::bootstrap(data_dir).map_err(|e| e.to_string())?;
            app.manage(Mutex::new(core));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![has_master_password, create_master_password, verify_master_password, get_login_status, verify_access_password, unlock_with_windows_hello, create_usb_recovery_file, unlock_with_usb_recovery, change_master_password, list_clients, get_full_case, save_client_case, move_client_to_trash, add_event, remove_event, list_pending_notifications, add_note, add_documents, select_document_paths, select_shared_folder, remove_document, open_document_folder, open_case_documents_folder, get_sync_status, create_lexarchivo_sync, join_lexarchivo_sync, list_shared_cases, publish_shared_case, get_shared_case, get_shared_publish_status, open_shared_case_folder, list_deleted_cases, move_case_to_trash, purge_deleted_case, archive_case, restore_case, create_backup, open_backups_folder, get_settings, save_settings, check_updates, load_demo_data, clear_demo_data])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(core) = app_handle.try_state::<SharedCore>() {
                    if let Ok(core) = core.lock() {
                        let _ = LocalBackupProvider(&core).create_backup();
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn core() -> AppCore {
        let dir = tempdir().unwrap().keep();
        AppCore::bootstrap(dir).unwrap()
    }

    #[test]
    fn ejecuta_migracion() {
        let core = core();
        let version: i64 = core.conn().unwrap().query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, 2);
    }

    #[test]
    fn crea_cliente_y_expediente() {
        let core = core();
        let full = SQLiteClientRepository(&core).save_client_case(UpsertClientRequest { client: ClientDraft { id: None, name: "Cliente Test".into(), tax_id: None, phone: None, email: None, address: None, registration_date: None, observations: None }, expediente: CaseDraft { id: None, case_number: None, matter_type: Some("Civil".into()), jurisdiction: None, status: Some("Abierto".into()), description: None, responsible_lawyer: Some("Abogada".into()), opened_at: None, closed_at: None, next_deadline: None }, opposing_party: None }).unwrap();
        assert!(full.expediente.case_number.starts_with("EXP-"));
    }

    #[test]
    fn anade_evento_y_restaura_archivado() {
        let core = core();
        let full = SQLiteClientRepository(&core).save_client_case(UpsertClientRequest { client: ClientDraft { id: None, name: "Cliente Evento".into(), tax_id: None, phone: None, email: None, address: None, registration_date: None, observations: None }, expediente: CaseDraft { id: None, case_number: None, matter_type: None, jurisdiction: None, status: Some("Abierto".into()), description: None, responsible_lawyer: None, opened_at: None, closed_at: None, next_deadline: None }, opposing_party: None }).unwrap();
        core.conn().unwrap().execute("INSERT INTO timeline_events (id, case_id, event_date, title, description, event_type, created_at, updated_at, version) VALUES (?1, ?2, ?3, 'Evento', '', 'llamada', ?4, ?4, 1)", params![id(), full.expediente.id, today(), now()]).unwrap();
        SQLiteCaseRepository(&core).archive_case(&full.expediente.id).unwrap();
        SQLiteCaseRepository(&core).restore_case(&full.expediente.id).unwrap();
        assert_eq!(SQLiteCaseRepository(&core).get_full_case(&full.expediente.id).unwrap().expediente.status, "Abierto");
    }

    #[test]
    fn manda_expediente_a_recien_eliminado_y_lo_purga() {
        let core = core();
        let full = SQLiteClientRepository(&core).save_client_case(UpsertClientRequest { client: ClientDraft { id: None, name: "Cliente Papelera".into(), tax_id: None, phone: None, email: None, address: None, registration_date: None, observations: None }, expediente: CaseDraft { id: None, case_number: None, matter_type: Some("Civil".into()), jurisdiction: None, status: Some("Abierto".into()), description: None, responsible_lawyer: None, opened_at: None, closed_at: None, next_deadline: None }, opposing_party: None }).unwrap();
        let conn = core.conn().unwrap();
        conn.execute("UPDATE cases SET deleted_at=?1 WHERE id=?2", params![now(), full.expediente.id]).unwrap();
        assert_eq!(list_deleted_case_summaries(&conn).unwrap().len(), 1);
        conn.execute("UPDATE cases SET deleted_at=NULL, status='Abierto' WHERE id=?1", [&full.expediente.id]).unwrap();
        assert!(list_deleted_case_summaries(&conn).unwrap().is_empty());
        conn.execute("UPDATE cases SET deleted_at=?1 WHERE id=?2", params![now(), full.expediente.id]).unwrap();
        purge_case_by_id(&conn, &full.expediente.id).unwrap();
        assert!(SQLiteCaseRepository(&core).get_full_case(&full.expediente.id).is_err());
    }

    #[test]
    fn crea_documento_y_copia() {
        let core = core();
        let source = core.data_dir.join("origen.txt");
        fs::write(&source, "contenido").unwrap();
        let full = SQLiteClientRepository(&core).save_client_case(UpsertClientRequest { client: ClientDraft { id: None, name: "Cliente Documento".into(), tax_id: None, phone: None, email: None, address: None, registration_date: None, observations: None }, expediente: CaseDraft { id: None, case_number: None, matter_type: None, jurisdiction: None, status: Some("Abierto".into()), description: None, responsible_lawyer: None, opened_at: None, closed_at: None, next_deadline: None }, opposing_party: None }).unwrap();
        LocalDocumentStorageProvider(&core).add_documents(&full.expediente.id, vec![source.to_string_lossy().to_string()], "nota".into(), false).unwrap();
        assert!(LocalBackupProvider(&core).create_backup().unwrap().exists());
    }
}
