//! Project-incarnation notebook ownership and whole-batch execution admission.
use crate::ops::Channel;
use ide_core::error::ErrorKind;
use ide_core::{CancellationToken, IdeError, IdeEvent, IdeResult, IpcPath, SharedSink};
pub use ide_lsp::session::{SessionFeature, SessionReply};
use ide_notebook::kernel::{KernelManager, KernelOutput, KernelRuntime};
use ide_notebook::{NotebookDocument, NotebookEdit, NotebookSnapshot};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex as AsyncMutex, watch};

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotebookOutputEvent {
    pub id: String,
    pub path: IpcPath,
    pub cell: String,
    pub msg_id: String,
    pub kind: String,
    #[specta(type = specta_typescript::Unknown)]
    pub content: serde_json::Value,
    pub version: u32,
    pub dirty: bool,
    pub changed_cells: Vec<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotebookDapQuery {
    pub selection: String,
    pub command: String,
    #[specta(type = specta_typescript::Unknown)]
    pub arguments: serde_json::Value,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct NotebookDapReply {
    #[specta(type = specta_typescript::Unknown)]
    pub body: serde_json::Value,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct NotebookDapEvent {
    pub event: String,
    #[specta(type = specta_typescript::Unknown)]
    pub body: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLspQuery {
    pub selection: String,
    pub cell: String,
    pub source: String,
    pub position: ide_core::Pos,
    pub feature: SessionFeature,
}

#[derive(Default)]
struct Registry {
    stopped: bool,
    paths: HashMap<PathBuf, String>,
    documents: HashMap<String, Arc<ManagedDocument>>,
}

struct ManagedDocument {
    id: String,
    path: PathBuf,
    state: Mutex<DocumentState>,
    control: AsyncMutex<()>,
}

struct DocumentState {
    document: NotebookDocument,
    generation: u64,
    transitioning: bool,
    closed: bool,
    active: Option<Arc<Batch>>,
    kernel_status: Option<(String, Option<String>)>,
}

struct Batch {
    cancel: CancellationToken,
    done: watch::Sender<bool>,
}

struct BatchGuard {
    document: Arc<ManagedDocument>,
    batch: Arc<Batch>,
}

pub(crate) struct ExecutionAdmission {
    guard: BatchGuard,
    generation: u64,
    plan: Vec<(String, String)>,
}

impl Drop for BatchGuard {
    fn drop(&mut self) {
        let mut state = self.document.state.lock();
        if state.active.as_ref().is_some_and(|active| Arc::ptr_eq(active, &self.batch)) {
            if let Err(error) = state.document.set_execution_active(false) {
                tracing::error!("notebook batch release: {error}");
            }
            state.active = None;
        }
        self.batch.done.send_replace(true);
    }
}

pub struct NotebookService {
    registry: Arc<Mutex<Registry>>,
    kernels: Arc<KernelManager>,
    sink: SharedSink,
}

impl NotebookService {
    pub fn new(runtime_dir: PathBuf, sink: SharedSink) -> Arc<Self> {
        let registry = Arc::new(Mutex::new(Registry::default()));
        let status_registry = registry.clone();
        let status_sink = sink.clone();
        let kernels = KernelManager::new(
            runtime_dir,
            Arc::new(move |path, status, message| {
                let document = {
                    let registry = status_registry.lock();
                    if registry.stopped {
                        return;
                    }
                    registry.paths.get(path).and_then(|id| registry.documents.get(id)).cloned()
                };
                if let Some(document) = document {
                    let deliver = {
                        let mut state = document.state.lock();
                        if state.closed {
                            return;
                        }
                        state.kernel_status = Some((status.as_str().to_owned(), message.clone()));
                        !state.transitioning
                    };
                    if deliver {
                        status_sink.emit(IdeEvent::NotebookKernel {
                            id: document.id.clone(),
                            path: path.to_path_buf().into(),
                            state: status.as_str().to_owned(),
                            message,
                        });
                    }
                }
            }),
        );
        Arc::new(Self { registry, kernels: Arc::new(kernels), sink })
    }

    pub fn open(&self, path: &Path) -> IdeResult<NotebookSnapshot> {
        let path = dunce::canonicalize(path)?;
        // Serialize first load with path insertion: split views share one incarnation.
        let mut registry = self.registry.lock();
        if registry.stopped {
            return Err(IdeError::cancelled());
        }
        if let Some(id) = registry.paths.get(&path) {
            return snapshot(&registry.documents[id]);
        }
        let document = NotebookDocument::load(&path)?;
        let initial = document.snapshot();
        let id = initial.id.clone();
        registry.paths.insert(path.clone(), id.clone());
        registry.documents.insert(
            id.clone(),
            Arc::new(ManagedDocument {
                id,
                path,
                state: Mutex::new(DocumentState {
                    document,
                    generation: 0,
                    transitioning: false,
                    closed: false,
                    active: None,
                    kernel_status: None,
                }),
                control: AsyncMutex::new(()),
            }),
        );
        Ok(initial)
    }

    /// In-memory document backing a Console; no notebook file or editor is needed.
    pub fn open_console(&self, root: &Path, key: &str) -> IdeResult<NotebookSnapshot> {
        if key.is_empty() || key.len() > 80 || !key.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
            return Err(IdeError::invalid("invalid console identity"));
        }
        let path = dunce::canonicalize(root)?.join(format!(".openide-console-{key}.ipynb"));
        let mut registry = self.registry.lock();
        if registry.stopped {
            return Err(IdeError::cancelled());
        }
        if let Some(id) = registry.paths.get(&path) {
            return snapshot(&registry.documents[id]);
        }
        let document = NotebookDocument::from_text(
            path.clone(),
            r#"{"nbformat":4,"nbformat_minor":5,"metadata":{},"cells":[]}"#.into(),
        )?;
        let initial = document.snapshot();
        let id = initial.id.clone();
        registry.paths.insert(path.clone(), id.clone());
        registry.documents.insert(
            id.clone(),
            Arc::new(ManagedDocument {
                id,
                path,
                state: Mutex::new(DocumentState {
                    document,
                    generation: 0,
                    transitioning: false,
                    closed: false,
                    active: None,
                    kernel_status: None,
                }),
                control: AsyncMutex::new(()),
            }),
        );
        Ok(initial)
    }

    fn resolve(&self, id: &str) -> IdeResult<Arc<ManagedDocument>> {
        let registry = self.registry.lock();
        if registry.stopped {
            return Err(IdeError::not_found("notebook project has closed"));
        }
        registry.documents.get(id).cloned().ok_or_else(|| IdeError::not_found("notebook incarnation is closed"))
    }

    pub fn get(&self, id: &str) -> IdeResult<NotebookSnapshot> {
        snapshot(self.resolve(id)?.as_ref())
    }

    pub fn edit(&self, id: &str, version: u32, edit: NotebookEdit) -> IdeResult<NotebookSnapshot> {
        let document = self.resolve(id)?;
        let mut state = document.state.lock();
        mutable(&state)?;
        state.document.edit(version, edit)
    }

    pub fn save(&self, id: &str) -> IdeResult<NotebookSnapshot> {
        let document = self.resolve(id)?;
        let mut state = document.state.lock();
        mutable(&state)?;
        state.document.save()
    }

    pub fn undo(&self, id: &str, redo: bool) -> IdeResult<NotebookSnapshot> {
        let document = self.resolve(id)?;
        let mut state = document.state.lock();
        mutable(&state)?;
        if state.active.is_some() {
            return Err(IdeError::unavailable("stop notebook execution before undo or redo"));
        }
        if redo { state.document.redo() } else { state.document.undo() }
    }

    pub async fn lsp(&self, id: &str, query: NotebookLspQuery, cancel: CancellationToken) -> IdeResult<SessionReply> {
        let document = self.resolve(id)?;
        let generation = {
            let state = document.state.lock();
            mutable(&state)?;
            if !state.document.snapshot().cells.iter().any(|c| c.id == query.cell && c.cell_type == "code") {
                return Err(IdeError::not_found("notebook code cell is closed"));
            }
            state.generation
        };
        let runtime = ide_notebook::parse_selection(&query.selection)?;
        let comms = self.kernels.comms(&document.path)?;
        if !matches!(runtime, KernelRuntime::Ark { .. }) || comms.runtime() != &runtime {
            return Err(IdeError::unavailable("selected Ark session has not been started; execute a cell first"));
        }
        // UUID cell identities are not paths supplied by the client. Use an escaped file URI
        // so Ark's file-based workspace understands each independent R cell.
        let path = document.path.with_file_name(format!("{}.{}.R", document.id, query.cell));
        let uri = ide_lsp::path_to_uri_string(&path);
        let result = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(IdeError::cancelled()),
            result = async {
                comms.ark_lsp().await?.query(&uri, &query.source, query.position, query.feature, cancel.clone()).await
            } => result,
        }?;
        let state = document.state.lock();
        if state.closed || state.transitioning || state.generation != generation || comms.is_closed() {
            return Err(IdeError::cancelled());
        }
        Ok(result)
    }

    pub async fn input_reply(&self, id: &str, prompt: String, value: Option<String>) -> IdeResult<()> {
        let document = self.resolve(id)?;
        {
            mutable(&document.state.lock())?;
        }
        self.kernels.comms(&document.path)?.input_reply(prompt, value).await
    }

    /// Notebook-first DAP API. Arguments/results use the DAP wire's 1-based coordinates.
    pub async fn dap(
        &self,
        id: &str,
        query: NotebookDapQuery,
        cancel: CancellationToken,
    ) -> IdeResult<NotebookDapReply> {
        if !matches!(
            query.command.as_str(),
            "threads"
                | "stackTrace"
                | "scopes"
                | "variables"
                | "evaluate"
                | "setBreakpoints"
                | "setExceptionBreakpoints"
                | "continue"
                | "next"
                | "stepIn"
                | "stepOut"
                | "pause"
                | "source"
        ) {
            return Err(IdeError::invalid("unsupported notebook DAP command"));
        }
        if !query.arguments.is_object() {
            return Err(IdeError::invalid("DAP arguments must be an object"));
        }
        let document = self.resolve(id)?;
        let generation = {
            let state = document.state.lock();
            mutable(&state)?;
            state.generation
        };
        let runtime = ide_notebook::parse_selection(&query.selection)?;
        let comms = self.kernels.comms(&document.path)?;
        if !matches!(runtime, KernelRuntime::Ark { .. }) || comms.runtime() != &runtime {
            return Err(IdeError::unavailable("selected Ark session has not been started"));
        }
        let result = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(IdeError::cancelled()),
            result = async { comms.ark_dap().await?.request(&query.command, query.arguments, cancel.clone()).await } => result,
        }?;
        let state = document.state.lock();
        if state.closed || state.transitioning || state.generation != generation || comms.is_closed() {
            return Err(IdeError::cancelled());
        }
        Ok(NotebookDapReply { body: result })
    }

    pub async fn dap_events(
        &self,
        id: &str,
        selection: &str,
        cancel: CancellationToken,
        channel: Channel<NotebookDapEvent>,
    ) -> IdeResult<()> {
        let document = self.resolve(id)?;
        let generation = {
            let state = document.state.lock();
            mutable(&state)?;
            state.generation
        };
        let runtime = ide_notebook::parse_selection(selection)?;
        let comms = self.kernels.comms(&document.path)?;
        if !matches!(runtime, KernelRuntime::Ark { .. }) || comms.runtime() != &runtime {
            return Err(IdeError::unavailable("selected Ark session has not been started"));
        }
        let mut events = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(IdeError::cancelled()),
            dap = comms.ark_dap() => dap?.subscribe(),
        };
        loop {
            let (event, body) = tokio::select! {
                biased;
                _ = cancel.cancelled() => return Err(IdeError::cancelled()),
                event = events.recv() => event?,
            };
            {
                let state = document.state.lock();
                if state.closed || state.transitioning || state.generation != generation || comms.is_closed() {
                    return Err(IdeError::cancelled());
                }
            }
            channel.send(NotebookDapEvent { event, body }).map_err(|e| IdeError::unavailable(e.to_string()))?;
        }
    }

    /// Selection changes stop the old kernel without reloading or discarding edits.
    pub async fn stop_kernel(&self, id: &str) -> IdeResult<()> {
        let document = self.resolve(id)?;
        let _control = document.control.lock().await;
        let batch = invalidate(&document)?;
        let result = async {
            self.kernels.shutdown_kernel(&document.path).await?;
            self.drain(&document, batch).await
        }
        .await;
        document.state.lock().transitioning = false;
        result
    }

    pub async fn interrupt(&self, id: &str) -> IdeResult<()> {
        let document = self.resolve(id)?;
        let batch = document.state.lock().active.clone();
        if let Some(batch) = &batch {
            batch.cancel.cancel();
        }
        // Draining makes prepareClose/save a stable checkpoint, including when
        // Python catches KeyboardInterrupt or cancel races with kernel startup.
        let interrupt = self.kernels.interrupt(&document.path).await;
        self.drain(&document, batch).await?;
        interrupt
    }

    async fn drain(&self, document: &ManagedDocument, batch: Option<Arc<Batch>>) -> IdeResult<()> {
        let Some(batch) = batch else { return Ok(()) };
        let mut done = batch.done.subscribe();
        match tokio::time::timeout(Duration::from_secs(5), done.wait_for(|done| *done)).await {
            Ok(Ok(_)) => return Ok(()),
            Ok(Err(_)) => return Err(IdeError::internal("notebook execution completion channel closed")),
            Err(_) => {}
        }
        // An uncooperative kernel must not outlive a close/reload authorization.
        self.kernels.shutdown_kernel(&document.path).await?;
        tokio::time::timeout(Duration::from_secs(5), done.wait_for(|done| *done))
            .await
            .map_err(|_| IdeError::unavailable("notebook execution did not stop after kernel shutdown"))?
            .map_err(|_| IdeError::internal("notebook execution completion channel closed"))?;
        Ok(())
    }

    pub async fn reload(&self, id: &str, restart: bool) -> IdeResult<NotebookSnapshot> {
        let document = self.resolve(id)?;
        let _control = document.control.lock().await;
        let batch = invalidate(&document)?;
        let result = async {
            let _ = self.kernels.interrupt(&document.path).await;
            self.drain(&document, batch).await?;
            if document.state.lock().closed {
                return Err(IdeError::cancelled());
            }
            if restart {
                self.kernels.restart(&document.path).await?;
                snapshot(&document)
            } else {
                self.kernels.shutdown_kernel(&document.path).await?;
                document.state.lock().document.reload()
            }
        }
        .await;
        let status = {
            let mut state = document.state.lock();
            state.transitioning = false;
            if state.closed { None } else { state.kernel_status.clone() }
        };
        if let Some((state, message)) = status {
            self.sink.emit(IdeEvent::NotebookKernel {
                id: document.id.clone(),
                path: document.path.clone().into(),
                state,
                message,
            });
        }
        result
    }

    /// Frontend disposal may arrive after project replacement has already retired this id.
    pub async fn close(&self, id: &str) -> IdeResult<()> {
        let document = match self.resolve(id) {
            Ok(document) => document,
            Err(error) if error.kind == ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        let _control = document.control.lock().await;
        if document.state.lock().closed {
            return Ok(());
        }
        let batch = invalidate(&document)?;
        let result = async {
            let _ = self.kernels.interrupt(&document.path).await;
            self.drain(&document, batch).await?;
            self.kernels.shutdown_kernel(&document.path).await
        }
        .await;
        if let Err(error) = result {
            document.state.lock().transitioning = false;
            return Err(error);
        }
        document.state.lock().closed = true;
        let mut registry = self.registry.lock();
        registry.documents.remove(id);
        registry.paths.remove(&document.path);
        Ok(())
    }

    pub(crate) fn admit(
        &self,
        id: &str,
        cells: Vec<String>,
        cancel: CancellationToken,
    ) -> IdeResult<ExecutionAdmission> {
        admit(self.resolve(id)?, cells, cancel)
    }

    pub(crate) async fn execute(
        self: &Arc<Self>,
        admission: ExecutionAdmission,
        runtime: KernelRuntime,
        on_output: Channel<NotebookOutputEvent>,
    ) -> IdeResult<NotebookSnapshot> {
        let document = admission.guard.document.clone();
        let service = self.clone();
        // Keep admission and native execution owned if an IPC receiver disappears.
        tokio::spawn(async move {
            let ExecutionAdmission { guard, generation, plan } = admission;
            let result =
                service.run_batch(document.clone(), generation, plan, runtime, guard.batch.clone(), on_output).await;
            drop(guard);
            match result {
                Ok(()) => snapshot(&document),
                Err(error) => Err(error),
            }
        })
        .await
        .map_err(|error| IdeError::internal(error.to_string()))?
    }

    async fn run_batch(
        &self,
        document: Arc<ManagedDocument>,
        generation: u64,
        plan: Vec<(String, String)>,
        runtime: KernelRuntime,
        batch: Arc<Batch>,
        on_output: Channel<NotebookOutputEvent>,
    ) -> IdeResult<()> {
        for (cell, source) in plan {
            {
                let mut state = document.state.lock();
                if batch.cancel.is_cancelled() || state.closed || state.generation != generation {
                    return Err(IdeError::cancelled());
                }
                // A user may delete a queued cell while an earlier one executes.
                // Never resurrect it from the captured source or a late output.
                match state.document.begin_execution(&cell) {
                    Ok(()) => {}
                    Err(error) if error.kind == ErrorKind::NotFound => continue,
                    Err(error) => return Err(error),
                }
            }
            let output_error = Arc::new(Mutex::new(None));
            let callback_document = document.clone();
            let callback_batch = batch.clone();
            let callback_error = output_error.clone();
            let callback_cell = cell.clone();
            let channel = on_output.clone();
            let result = self
                .kernels
                .execute_with_stdin(
                    &document.path,
                    &runtime,
                    &source,
                    true,
                    batch.cancel.clone(),
                    Arc::new(move |output: KernelOutput| {
                        let event = match commit_output(
                            &callback_document,
                            &callback_batch,
                            generation,
                            &callback_cell,
                            output,
                        ) {
                            Ok(Some(event)) => event,
                            Ok(None) => return,
                            Err(error) => {
                                *callback_error.lock() = Some(error);
                                callback_batch.cancel.cancel();
                                return;
                            }
                        };
                        let _ = channel.send(event);
                    }),
                )
                .await;
            if let Some(error) = output_error.lock().take() {
                return Err(error);
            }
            let result = result?;
            if batch.cancel.is_cancelled() {
                return Err(IdeError::cancelled());
            }
            if result.status != "ok" {
                break;
            }
        }
        let state = document.state.lock();
        if state.closed || state.generation != generation || batch.cancel.is_cancelled() {
            return Err(IdeError::cancelled());
        }
        Ok(())
    }

    /// Synchronously revoke admission before handing cleanup to an async runtime.
    pub fn stop_admission(&self) {
        let mut registry = self.registry.lock();
        registry.stopped = true;
        for document in registry.documents.values() {
            let mut state = document.state.lock();
            state.closed = true;
            state.generation += 1;
            if let Some(batch) = &state.active {
                batch.cancel.cancel();
            }
        }
    }

    pub async fn restrict(&self) {
        let documents: Vec<_> = self.registry.lock().documents.values().cloned().collect();
        for document in &documents {
            let mut state = document.state.lock();
            state.generation += 1;
            if let Some(batch) = &state.active {
                batch.cancel.cancel();
            }
        }
        for document in documents {
            let _ = self.kernels.shutdown_kernel(&document.path).await;
            let batch = document.state.lock().active.clone();
            if let Err(error) = self.drain(&document, batch).await {
                tracing::warn!("notebook restriction: {error}");
            }
        }
    }

    pub async fn shutdown(&self) {
        self.stop_admission();
        self.kernels.shutdown().await;
        let documents: Vec<_> = self.registry.lock().documents.values().cloned().collect();
        for document in documents {
            let batch = document.state.lock().active.clone();
            if let Err(error) = self.drain(&document, batch).await {
                tracing::error!("notebook cleanup: {error}");
            }
        }
        let mut registry = self.registry.lock();
        registry.paths.clear();
        registry.documents.clear();
    }
}

fn mutable(state: &DocumentState) -> IdeResult<()> {
    if state.closed {
        Err(IdeError::not_found("notebook incarnation is closed"))
    } else if state.transitioning {
        Err(IdeError::unavailable("notebook lifecycle operation is in progress"))
    } else {
        Ok(())
    }
}

fn snapshot(document: &ManagedDocument) -> IdeResult<NotebookSnapshot> {
    let state = document.state.lock();
    if state.closed {
        return Err(IdeError::not_found("notebook incarnation is closed"));
    }
    Ok(state.document.snapshot())
}

fn invalidate(document: &ManagedDocument) -> IdeResult<Option<Arc<Batch>>> {
    let mut state = document.state.lock();
    mutable(&state)?;
    state.transitioning = true;
    state.generation += 1;
    if let Some(batch) = &state.active {
        batch.cancel.cancel();
    }
    Ok(state.active.clone())
}

fn execution_plan(snapshot: &NotebookSnapshot, cells: Vec<String>) -> IdeResult<Vec<(String, String)>> {
    let mut selected: HashSet<_> = cells.iter().map(String::as_str).collect();
    if selected.is_empty() || selected.len() != cells.len() {
        return Err(IdeError::invalid("select distinct code cells to execute"));
    }
    let mut plan = Vec::with_capacity(selected.len());
    for cell in &snapshot.cells {
        if selected.remove(cell.id.as_str()) {
            if cell.cell_type != "code" {
                return Err(IdeError::invalid("only code cells can execute"));
            }
            plan.push((cell.id.clone(), cell.source.clone()));
        }
    }
    if !selected.is_empty() {
        return Err(IdeError::not_found("an execution cell no longer exists"));
    }
    Ok(plan)
}

fn admit(
    document: Arc<ManagedDocument>,
    cells: Vec<String>,
    cancel: CancellationToken,
) -> IdeResult<ExecutionAdmission> {
    let (batch, generation, plan) = {
        let mut state = document.state.lock();
        mutable(&state)?;
        if state.active.is_some() {
            return Err(IdeError::unavailable("notebook execution batch is already running"));
        }
        if cancel.is_cancelled() {
            return Err(IdeError::cancelled());
        }
        let plan = execution_plan(&state.document.snapshot(), cells)?;
        state.document.set_execution_active(true)?;
        let (done, _) = watch::channel(false);
        let batch = Arc::new(Batch { cancel, done });
        state.active = Some(batch.clone());
        (batch, state.generation, plan)
    };
    Ok(ExecutionAdmission { guard: BatchGuard { document, batch }, generation, plan })
}

/// Commit under the short document lock; the caller delivers only after release.
fn commit_output(
    document: &ManagedDocument,
    batch: &Arc<Batch>,
    generation: u64,
    cell: &str,
    output: KernelOutput,
) -> IdeResult<Option<NotebookOutputEvent>> {
    let mut state = document.state.lock();
    if state.closed
        || state.generation != generation
        || !state.active.as_ref().is_some_and(|active| Arc::ptr_eq(active, batch))
    {
        return Ok(None);
    }
    let changed_cells = if output.kind == "input_request" {
        Vec::new()
    } else {
        match state.document.record_output(cell, &output) {
            Ok(changed) => changed,
            Err(error) if error.kind == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        }
    };
    Ok(Some(NotebookOutputEvent {
        id: document.id.clone(),
        path: document.path.clone().into(),
        cell: cell.to_owned(),
        msg_id: output.msg_id,
        kind: output.kind,
        content: output.content,
        version: state.document.version(),
        dirty: state.document.is_dirty(),
        changed_cells,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (tempfile::TempDir, Arc<NotebookService>, NotebookSnapshot) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.ipynb");
        std::fs::write(&path, serde_json::to_vec(&json!({
            "nbformat": 4, "nbformat_minor": 5, "metadata": {},
            "cells": [
                {"id":"first","cell_type":"code","metadata":{},"source":"x = 1","outputs":[],"execution_count":null},
                {"id":"second","cell_type":"code","metadata":{},"source":"print(x)","outputs":[],"execution_count":null},
                {"id":"prose","cell_type":"markdown","metadata":{},"source":"notes"}
            ]
        })).unwrap()).unwrap();
        let service = NotebookService::new(dir.path().join("kernels"), Arc::new(ide_core::NullSink));
        let snapshot = service.open(&path).unwrap();
        (dir, service, snapshot)
    }

    #[tokio::test]
    async fn u7_console_transient_identity_and_cleanup() {
        let dir = tempfile::tempdir().unwrap();
        let service = NotebookService::new(dir.path().join("kernels"), Arc::new(ide_core::NullSink));
        let a = service.open_console(dir.path(), "a").unwrap();
        let b = service.open_console(dir.path(), "b").unwrap();
        assert_ne!(a.id, b.id);
        assert_eq!(service.open_console(dir.path(), "a").unwrap().id, a.id);
        assert!(service.open_console(dir.path(), "../escape").is_err());
        assert!(!a.path.exists());
        service.close(&a.id).await.unwrap();
        assert!(service.get(&b.id).is_ok());
        assert_ne!(service.open_console(dir.path(), "a").unwrap().id, a.id);
        service.shutdown().await;
    }

    async fn u7_execute(
        service: &Arc<NotebookService>,
        id: &str,
        runtime: KernelRuntime,
        source: &str,
    ) -> NotebookSnapshot {
        let s = service.get(id).unwrap();
        let s = service
            .edit(
                id,
                s.version,
                NotebookEdit::InsertCell { after: s.cells.last().map(|c| c.id.clone()), cell_type: "code".into() },
            )
            .unwrap();
        let cell = s.cells.last().unwrap().id.clone();
        let s =
            service.edit(id, s.version, NotebookEdit::SetSource { cell: cell.clone(), source: source.into() }).unwrap();
        let admission = service.admit(id, vec![cell], CancellationToken::new()).unwrap();
        let result =
            tokio::time::timeout(Duration::from_secs(60), service.execute(admission, runtime, Channel::new(|_| {})))
                .await
                .unwrap()
                .unwrap();
        assert_eq!(s.id, result.id);
        result
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore = "real runtime: OPENIDE_U7_RUNTIME=python|ark and ENV.md runtime setup"]
    async fn u7_console_real_runtime() {
        let ark = std::env::var("OPENIDE_U7_RUNTIME").unwrap() == "ark";
        let runtime = if ark {
            KernelRuntime::Ark {
                executable: std::env::var_os("OPENIDE_ARK").unwrap().into(),
                r_home: std::env::var_os("R_HOME").unwrap().into(),
            }
        } else {
            KernelRuntime::python(std::env::var_os("OPENIDEA_TEST_PYTHON").unwrap())
        };
        let dir = tempfile::tempdir().unwrap();
        let runtime_dir = dir.path().join("kernels");
        let service = NotebookService::new(runtime_dir.clone(), Arc::new(ide_core::NullSink));
        let a = service.open_console(dir.path(), "real-a").unwrap();
        let b = service.open_console(dir.path(), "real-b").unwrap();
        let assign = if ark { "u7_value <- 41" } else { "u7_value = 41" };
        u7_execute(&service, &a.id, runtime.clone(), assign).await;
        let result =
            u7_execute(&service, &a.id, runtime.clone(), if ark { "u7_value + 1" } else { "print(u7_value + 1)" })
                .await;
        assert!(serde_json::to_string(&result.cells.last().unwrap().outputs).unwrap().contains("42"));
        let independent = u7_execute(
            &service,
            &b.id,
            runtime.clone(),
            if ark { "exists('u7_value')" } else { "print('u7_value' in globals())" },
        )
        .await;
        assert!(
            serde_json::to_string(&independent.cells.last().unwrap().outputs).unwrap().to_lowercase().contains("false")
        );
        println!("PASS real retained state=42 and second Console isolation; ark={ark}");
        // Real transient stdin, followed by a reply and then close during another prompt.
        for close in [false, true] {
            let s = service.get(&a.id).unwrap();
            let s = service
                .edit(
                    &a.id,
                    s.version,
                    NotebookEdit::InsertCell { after: s.cells.last().map(|c| c.id.clone()), cell_type: "code".into() },
                )
                .unwrap();
            let cell = s.cells.last().unwrap().id.clone();
            let source = if ark { "paste0(readline('u7>'), '-ok')" } else { "print(input('u7>') + '-ok')" };
            service
                .edit(&a.id, s.version, NotebookEdit::SetSource { cell: cell.clone(), source: source.into() })
                .unwrap();
            let admission = service.admit(&a.id, vec![cell], CancellationToken::new()).unwrap();
            let (send, mut receive) = tokio::sync::mpsc::unbounded_channel();
            let running = service.clone();
            let runtime = runtime.clone();
            let execution = tokio::spawn(async move {
                running
                    .execute(
                        admission,
                        runtime,
                        Channel::new(move |event| {
                            let _ = send.send(event);
                        }),
                    )
                    .await
            });
            let prompt = tokio::time::timeout(Duration::from_secs(30), async {
                loop {
                    let event = receive.recv().await.unwrap();
                    if event.kind == "input_request" {
                        break event;
                    }
                }
            })
            .await
            .unwrap();
            let prompt_id = prompt.content["requestId"].as_str().unwrap().to_owned();
            if close {
                service.close(&a.id).await.unwrap();
            } else {
                service.input_reply(&a.id, prompt_id.clone(), Some("answer".into())).await.unwrap();
            }
            let result = tokio::time::timeout(Duration::from_secs(15), execution).await.unwrap().unwrap();
            if !close {
                assert!(
                    serde_json::to_string(&result.unwrap().cells.last().unwrap().outputs)
                        .unwrap()
                        .contains("answer-ok")
                );
            }
            assert!(service.input_reply(&a.id, prompt_id, Some("late".into())).await.is_err());
        }
        println!("PASS real stdin reply and close while awaiting input; late reply rejected");
        assert!(service.get(&b.id).is_ok());
        service.stop_kernel(&b.id).await.unwrap();
        let restarted = u7_execute(
            &service,
            &b.id,
            runtime,
            if ark { "exists('u7_value')" } else { "print('u7_value' in globals())" },
        )
        .await;
        assert!(
            serde_json::to_string(&restarted.cells.last().unwrap().outputs).unwrap().to_lowercase().contains("false")
        );
        service.close(&b.id).await.unwrap();
        service.shutdown().await;
        assert!(!a.path.exists());
        assert!(!b.path.exists());
        assert!(std::fs::read_dir(&runtime_dir).unwrap().next().is_none());
        println!("VERIFIED real transient Console restart/close, no notebook files, kernel runtime directory empty");
    }

    fn output(kind: &str, content: serde_json::Value) -> KernelOutput {
        KernelOutput { kind: kind.into(), content, msg_id: "actual-parent-request".into() }
    }

    #[tokio::test]
    async fn canonical_split_opens_share_incarnation_but_reopen_and_projects_do_not() {
        let (dir, service, initial) = fixture();
        let alternate = dir.path().join(".").join("session.ipynb");
        assert_eq!(service.open(&alternate).unwrap().id, initial.id);
        let other = NotebookService::new(dir.path().join("other-runtime"), Arc::new(ide_core::NullSink));
        let independent = other.open(&alternate).unwrap();
        assert_ne!(initial.id, independent.id);
        assert_eq!(other.get(&initial.id).unwrap_err().kind, ErrorKind::NotFound);
        service.close(&initial.id).await.unwrap();
        let reopened = service.open(&alternate).unwrap();
        assert_ne!(reopened.id, initial.id);
        assert_eq!(service.get(&initial.id).unwrap_err().kind, ErrorKind::NotFound);
        // A delayed old-incarnation close cannot dispose a new session at that path.
        service.close(&initial.id).await.unwrap();
        assert_eq!(service.get(&reopened.id).unwrap().id, reopened.id);
        service.shutdown().await;
        other.shutdown().await;
    }

    #[tokio::test]
    async fn the_notebook_path_reaches_the_ui_as_the_project_tree_names_it() {
        let (dir, service, _) = fixture();
        let ui_path =
            format!("{}/session.ipynb", ide_core::ipc_path::to_ipc(&dunce::canonicalize(dir.path()).unwrap()));
        let snapshot = service.open(Path::new(&ui_path)).unwrap();
        assert_eq!(serde_json::to_value(&snapshot).unwrap()["path"], ui_path);
        service.shutdown().await;
    }

    #[tokio::test(start_paused = true)]
    async fn failed_close_keeps_the_incarnation_recoverable_until_a_retry_succeeds() {
        let (dir, service, initial) = fixture();
        // A batch that never drains models a kernel that ignores interrupt and shutdown.
        let admission =
            service.admit(&initial.id, vec![initial.cells[0].id.clone()], CancellationToken::new()).unwrap();
        let error = service.close(&initial.id).await.unwrap_err();
        assert_eq!(error.kind, ErrorKind::Unavailable);
        assert!(admission.guard.batch.cancel.is_cancelled());
        // The backend still owns the incarnation: a reopen shares it instead of
        // starting a second kernel, and the failed close left it usable.
        let reopened = service.open(&dir.path().join("session.ipynb")).unwrap();
        assert_eq!(reopened.id, initial.id);
        assert!(matches!(service.admit(&initial.id, vec![initial.cells[0].id.clone()], CancellationToken::new()),
            Err(error) if error.kind == ErrorKind::Unavailable));
        drop(admission);
        service.close(&initial.id).await.unwrap();
        assert_eq!(service.get(&initial.id).unwrap_err().kind, ErrorKind::NotFound);
        assert_ne!(service.open(&dir.path().join("session.ipynb")).unwrap().id, initial.id);
        service.shutdown().await;
    }

    #[test]
    fn batch_admission_captures_document_order_and_retains_busy_until_drained() {
        let (_dir, service, initial) = fixture();
        let document = service.resolve(&initial.id).unwrap();
        let cells = vec![initial.cells[1].id.clone(), initial.cells[0].id.clone()];
        let admission = admit(document.clone(), cells.clone(), CancellationToken::new()).unwrap();
        assert_eq!(
            admission.plan,
            vec![(initial.cells[0].id.clone(), "x = 1".into()), (initial.cells[1].id.clone(), "print(x)".into()),]
        );
        service
            .edit(
                &initial.id,
                initial.version,
                NotebookEdit::SetSource { cell: initial.cells[1].id.clone(), source: "print('new source')".into() },
            )
            .unwrap();
        assert_eq!(admission.plan[1].1, "print(x)");
        assert_eq!(service.undo(&initial.id, false).unwrap_err().kind, ErrorKind::Unavailable);
        admission.guard.batch.cancel.cancel();
        assert!(matches!(admit(document.clone(), cells.clone(), CancellationToken::new()), Err(error)
            if error.kind == ErrorKind::Unavailable));
        drop(admission);
        let next = admit(document, cells, CancellationToken::new()).unwrap();
        assert_eq!(next.plan[1].1, "print('new source')");
    }

    #[test]
    fn output_commits_revision_and_cross_cell_display_updates_before_delivery() {
        let (_dir, service, initial) = fixture();
        let document = service.resolve(&initial.id).unwrap();
        let cells: Vec<_> = initial.cells[..2].iter().map(|cell| cell.id.clone()).collect();
        let admission = admit(document.clone(), cells.clone(), CancellationToken::new()).unwrap();
        let event = commit_output(
            &document,
            &admission.guard.batch,
            admission.generation,
            &cells[0],
            output(
                "display_data",
                json!({"data":{"text/plain":"before"},"metadata":{},"transient":{"display_id":"shared"}}),
            ),
        )
        .unwrap()
        .unwrap();
        let committed = service.get(&initial.id).unwrap();
        assert_eq!(event.version, committed.version);
        assert!(event.version > initial.version);
        assert!(event.dirty);
        assert_eq!(event.msg_id, "actual-parent-request");
        assert_eq!(committed.cells[0].outputs[0]["data"]["text/plain"], "before");
        let updated = commit_output(
            &document,
            &admission.guard.batch,
            admission.generation,
            &cells[1],
            output(
                "update_display_data",
                json!({"data":{"text/plain":"after"},"metadata":{},"transient":{"display_id":"shared"}}),
            ),
        )
        .unwrap()
        .unwrap();
        assert!(updated.changed_cells.contains(&cells[0]));
        let committed = service.get(&initial.id).unwrap();
        assert_eq!(committed.cells[0].outputs[0]["data"]["text/plain"], "after");
        assert!(committed.cells[0].outputs[0].get("transient").is_none());
        assert_eq!(updated.version, committed.version);
    }

    #[test]
    fn invalidated_or_completed_batches_cannot_commit_and_deleted_cells_stay_deleted() {
        let (_dir, service, initial) = fixture();
        let document = service.resolve(&initial.id).unwrap();
        let cell = initial.cells[0].id.clone();
        let admission = admit(document.clone(), vec![cell.clone()], CancellationToken::new()).unwrap();
        let deleted =
            service.edit(&initial.id, initial.version, NotebookEdit::DeleteCell { cell: cell.clone() }).unwrap();
        assert!(
            commit_output(
                &document,
                &admission.guard.batch,
                admission.generation,
                &cell,
                output("stream", json!({"name":"stdout","text":"late"}))
            )
            .unwrap()
            .is_none()
        );
        assert_eq!(service.get(&initial.id).unwrap().version, deleted.version);
        let other = initial.cells[1].id.clone();
        invalidate(&document).unwrap();
        assert!(admission.guard.batch.cancel.is_cancelled());
        assert!(
            commit_output(
                &document,
                &admission.guard.batch,
                admission.generation,
                &other,
                output("stream", json!({"name":"stdout","text":"old generation"}))
            )
            .unwrap()
            .is_none()
        );
        let batch = admission.guard.batch.clone();
        let generation = document.state.lock().generation;
        drop(admission);
        assert!(
            commit_output(
                &document,
                &batch,
                generation,
                &other,
                output("stream", json!({"name":"stdout","text":"post idle"}))
            )
            .unwrap()
            .is_none()
        );
        assert_eq!(service.get(&initial.id).unwrap().version, deleted.version);
    }

    #[tokio::test]
    async fn reload_preserves_incarnation_and_project_shutdown_revokes_all_admission() {
        let (_dir, service, initial) = fixture();
        let changed = service
            .edit(
                &initial.id,
                initial.version,
                NotebookEdit::SetSource { cell: initial.cells[0].id.clone(), source: "changed".into() },
            )
            .unwrap();
        let reloaded = service.reload(&initial.id, false).await.unwrap();
        assert_eq!(reloaded.id, initial.id);
        assert!(reloaded.version > changed.version);
        assert_eq!(reloaded.cells[0].source, "x = 1");
        assert!(!reloaded.dirty);
        let document = service.resolve(&initial.id).unwrap();
        let admission = admit(document.clone(), vec![initial.cells[0].id.clone()], CancellationToken::new()).unwrap();
        service.stop_admission();
        assert!(admission.guard.batch.cancel.is_cancelled());
        assert_eq!(service.get(&initial.id).unwrap_err().kind, ErrorKind::NotFound);
        assert!(matches!(admit(document, vec![initial.cells[0].id.clone()], CancellationToken::new()), Err(error)
            if error.kind == ErrorKind::NotFound));
        drop(admission);
        service.shutdown().await;
    }

    #[test]
    fn invalid_batch_selection_does_not_claim_admission() {
        let (_dir, service, initial) = fixture();
        let document = service.resolve(&initial.id).unwrap();
        for cells in [
            vec![],
            vec![initial.cells[0].id.clone(), initial.cells[0].id.clone()],
            vec![initial.cells[2].id.clone()],
            vec!["deleted".into()],
        ] {
            assert!(admit(document.clone(), cells, CancellationToken::new()).is_err());
        }
        let cancelled = CancellationToken::new();
        cancelled.cancel();
        assert!(matches!(admit(document.clone(), vec![initial.cells[0].id.clone()], cancelled), Err(error)
            if error.kind == ErrorKind::Cancelled));
        let valid = admit(document, vec![initial.cells[0].id.clone()], CancellationToken::new()).unwrap();
        assert_eq!(valid.plan[0].1, "x = 1");
    }

    #[tokio::test]
    async fn interrupt_cancels_before_drain_and_does_not_release_a_live_batch() {
        let (_dir, service, initial) = fixture();
        service
            .edit(
                &initial.id,
                initial.version,
                NotebookEdit::SetSource { cell: initial.cells[0].id.clone(), source: "changed source".into() },
            )
            .unwrap();
        let cancel = CancellationToken::new();
        let admission = service.admit(&initial.id, vec![initial.cells[0].id.clone()], cancel.clone()).unwrap();
        let interrupt_service = service.clone();
        let id = initial.id.clone();
        let interrupt = tokio::spawn(async move { interrupt_service.interrupt(&id).await });
        tokio::time::timeout(Duration::from_secs(1), cancel.cancelled()).await.unwrap();
        assert!(!interrupt.is_finished(), "interrupt must wait for owned execution to drain");
        assert!(matches!(service.admit(&initial.id, vec![initial.cells[0].id.clone()], CancellationToken::new()),
            Err(error) if error.kind == ErrorKind::Unavailable));
        let mut done = admission.guard.batch.done.subscribe();
        drop(admission);
        assert!(*done.borrow_and_update());
        tokio::time::timeout(Duration::from_secs(1), interrupt).await.unwrap().unwrap().unwrap();
        let next = service.admit(&initial.id, vec![initial.cells[0].id.clone()], CancellationToken::new()).unwrap();
        assert_eq!(next.plan[0].1, "changed source");
        drop(next);
        let undone = service.undo(&initial.id, false).unwrap();
        assert_eq!(undone.cells[0].source, "x = 1");
        service.close(&initial.id).await.unwrap();
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires real Ark and R_HOME"]
    async fn ark_notebook_cell_lsp_uses_execution_session() {
        let (_dir, service, initial) = fixture();
        let runtime = KernelRuntime::Ark {
            executable: std::env::var_os("OPENIDE_ARK").expect("OPENIDE_ARK").into(),
            r_home: std::env::var_os("R_HOME").expect("R_HOME").into(),
        };
        let KernelRuntime::Ark { executable, r_home } = &runtime else { unreachable!() };
        let selection = ide_notebook::discover::encode_ark(executable, r_home);
        let cell = initial.cells[0].id.clone();
        service
            .edit(
                &initial.id,
                initial.version,
                NotebookEdit::SetSource {
                    cell: cell.clone(),
                    source: "openide_host_only <- function(z) z + 41; openide_host_only(1)".into(),
                },
            )
            .unwrap();
        let admission = service.admit(&initial.id, vec![cell.clone()], CancellationToken::new()).unwrap();
        let executed = service.execute(admission, runtime, Channel::new(|_| {})).await.unwrap();
        assert!(
            executed.cells[0]
                .outputs
                .iter()
                .any(|o| o["data"]["text/plain"].as_str().is_some_and(|s| s.contains("42")))
        );
        let mut query = NotebookLspQuery {
            selection,
            cell,
            source: "openide_host_on\nmean(1)\n".into(),
            position: ide_core::Pos::new(0, 15),
            feature: SessionFeature::Completion,
        };
        let SessionReply::Completion { items } =
            service.lsp(&initial.id, query.clone(), CancellationToken::new()).await.unwrap()
        else {
            panic!("completion expected")
        };
        assert!(items.iter().any(|i| i.label == "openide_host_only"));
        query.feature = SessionFeature::Hover;
        query.position = ide_core::Pos::new(1, 2);
        let SessionReply::Hover { text } =
            service.lsp(&initial.id, query.clone(), CancellationToken::new()).await.unwrap()
        else {
            panic!("hover expected")
        };
        assert!(text.is_some_and(|s| s.contains("Mean")));
        println!("PASS NotebookService real R cell execution 42 + execution-only completion + mean hover");
        let mut wrong = query.clone();
        wrong.selection = "ark|/different/ark|/different/R".into();
        assert!(service.lsp(&initial.id, wrong, CancellationToken::new()).await.is_err());
        service.stop_kernel(&initial.id).await.unwrap();
        assert!(service.lsp(&initial.id, query.clone(), CancellationToken::new()).await.is_err());
        assert_eq!(service.get(&initial.id).unwrap().cells[0].source, executed.cells[0].source);
        println!("PASS selection stop revokes LSP without discarding source; mismatched runtime rejected");
        service.close(&initial.id).await.unwrap();
        assert!(service.lsp(&initial.id, query, CancellationToken::new()).await.is_err());
        service.shutdown().await;
        println!("VERIFIED U4 NotebookService execution/editor cell route and close revocation");
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore = "requires real Ark and R_HOME"]
    async fn ark_stdin_host_api() {
        let (_dir, service, initial) = fixture();
        let runtime = KernelRuntime::Ark {
            executable: std::env::var_os("OPENIDE_ARK")
                .unwrap_or_else(|| "/workspace/ark/target/release/ark".into())
                .into(),
            r_home: std::env::var_os("R_HOME").expect("R_HOME required").into(),
        };
        let selection = format!("ark|{}|{}", runtime.executable().display(), std::env::var("R_HOME").unwrap());
        let edited = service
            .edit(
                &initial.id,
                initial.version,
                NotebookEdit::SetSource {
                    cell: initial.cells[0].id.clone(),
                    source: "paste0(readline('host>'), '-host')".into(),
                },
            )
            .unwrap();
        let admission = service.admit(&initial.id, vec![edited.cells[0].id.clone()], CancellationToken::new()).unwrap();
        let (send, mut receive) = tokio::sync::mpsc::unbounded_channel();
        let running = service.clone();
        let execution = tokio::spawn(async move {
            running
                .execute(
                    admission,
                    runtime,
                    Channel::new(move |event| {
                        let _ = send.send(event);
                    }),
                )
                .await
        });
        let prompt = tokio::time::timeout(std::time::Duration::from_secs(45), async {
            loop {
                let event = receive.recv().await.unwrap();
                if event.kind == "input_request" {
                    break event;
                }
            }
        })
        .await
        .unwrap();
        assert!(prompt.changed_cells.is_empty());
        assert_eq!(prompt.content["prompt"], "host>");
        assert!(service.get(&initial.id).unwrap().cells[0].outputs.is_empty());
        service
            .input_reply(&initial.id, prompt.content["requestId"].as_str().unwrap().into(), Some("answer".into()))
            .await
            .unwrap();
        let snapshot =
            tokio::time::timeout(std::time::Duration::from_secs(10), execution).await.unwrap().unwrap().unwrap();
        let serialized = serde_json::to_string(&snapshot.cells[0].outputs).unwrap();
        assert!(serialized.contains("answer-host"));
        assert!(!serialized.contains("input_request"));
        let reply = service
            .dap(
                &initial.id,
                NotebookDapQuery { selection, command: "threads".into(), arguments: json!({}) },
                CancellationToken::new(),
            )
            .await
            .unwrap();
        assert!(!reply.body["threads"].as_array().unwrap().is_empty());
        assert!(
            service
                .dap(
                    &initial.id,
                    NotebookDapQuery {
                        selection: "not-selected".into(),
                        command: "launch".into(),
                        arguments: json!({})
                    },
                    CancellationToken::new()
                )
                .await
                .is_err()
        );
        service.stop_kernel(&initial.id).await.unwrap();
        assert!(
            service
                .input_reply(&initial.id, prompt.content["requestId"].as_str().unwrap().into(), Some("late".into()))
                .await
                .is_err()
        );
        service.shutdown().await;
        println!(
            "VERIFIED host stdin Channel -> reply -> notebook result, prompt not persisted; DAP threads API; stop revokes handles"
        );
    }
}
