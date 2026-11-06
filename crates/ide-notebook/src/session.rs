//! Language-neutral, generation-bound variables and plot history.
//! Ark protocol is read from its public MIT sources; no Positron UI code is used.
use crate::kernel::KernelRuntime;
use crate::kernel::comm::CommRequest;
use ide_core::{CancellationToken, IdeError, IdeResult};
use jupyter_protocol::{CommId, CommMsg};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use specta::Type;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, Weak};
use tokio::sync::{mpsc, oneshot};

const MAX_VARIABLES: usize = 200;
const MAX_PLOTS: usize = 50;
const MAX_PLOT_BYTES: usize = 16 * 1024 * 1024;
type Pending = HashMap<String, oneshot::Sender<IdeResult<Value>>>;
type Registry = Mutex<Vec<Weak<SessionData>>>;
static SESSIONS: OnceLock<Registry> = OnceLock::new();

struct PendingRequest<'a> {
    pending: &'a Mutex<Pending>,
    id: String,
}

impl Drop for PendingRequest<'_> {
    fn drop(&mut self) {
        self.pending.lock().remove(&self.id);
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionVariable {
    pub key: String,
    pub name: String,
    pub type_name: String,
    pub summary: String,
    pub has_children: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionPlot {
    pub id: String,
    pub mime: String,
    pub data: String,
    pub execution_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub generation: String,
    pub path: ide_core::IpcPath,
    pub language: String,
    pub revision: u32,
    pub variables: Vec<SessionVariable>,
    pub total: u32,
    pub plots: Vec<SessionPlot>,
    pub ready: bool,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionChildren {
    pub generation: String,
    pub revision: u32,
    pub variables: Vec<SessionVariable>,
    pub total: u32,
}

pub struct SessionData {
    owner: PathBuf,
    path: PathBuf,
    pub(crate) comm_id: String,
    stop: CancellationToken,
    requests: mpsc::Sender<CommRequest>,
    state: Mutex<SessionSnapshot>,
    backend_version: Mutex<u64>,
    pending: Mutex<Pending>,
    plot_comms: Mutex<Vec<String>>,
}

impl SessionData {
    pub(crate) fn new(
        owner: PathBuf,
        path: PathBuf,
        runtime: &KernelRuntime,
        stop: CancellationToken,
        requests: mpsc::Sender<CommRequest>,
    ) -> Arc<Self> {
        let data = Arc::new(Self {
            state: Mutex::new(SessionSnapshot {
                generation: uuid::Uuid::new_v4().to_string(),
                path: path.clone().into(),
                language: crate::session_adapter::SessionAdapter::for_runtime(runtime).language.into(),
                revision: 0,
                variables: vec![],
                total: 0,
                plots: vec![],
                ready: false,
                error: None,
            }),
            owner,
            path,
            comm_id: uuid::Uuid::new_v4().to_string(),
            stop,
            requests,
            pending: Mutex::new(HashMap::new()),
            backend_version: Mutex::new(0),
            plot_comms: Mutex::new(vec![]),
        });
        let mut registry = SESSIONS.get_or_init(Default::default).lock();
        registry.retain(|entry| entry.upgrade().is_some_and(|data| !data.stop.is_cancelled()));
        registry.push(Arc::downgrade(&data));
        data
    }

    /// Both the project-incarnation runtime namespace and document path must
    /// match. A different window opening the same file cannot borrow its data.
    pub fn for_owner_path(owner: &Path, path: &Path) -> IdeResult<Option<Arc<Self>>> {
        let mut registry = SESSIONS.get_or_init(Default::default).lock();
        let mut matches = Vec::new();
        registry.retain(|entry| {
            let Some(data) = entry.upgrade().filter(|data| !data.stop.is_cancelled()) else { return false };
            if data.owner == owner && data.path == path {
                matches.push(data);
            }
            true
        });
        if matches.len() > 1 {
            return Err(IdeError::unavailable("multiple project sessions own this path"));
        }
        Ok(matches.pop())
    }

    pub fn snapshot(&self) -> IdeResult<SessionSnapshot> {
        let state = self.state.lock();
        if self.stop.is_cancelled() {
            return Err(IdeError::cancelled());
        }
        Ok(state.clone())
    }

    pub async fn inspect(&self, generation: &str, revision: u32, path: Vec<String>) -> IdeResult<SessionChildren> {
        if path.is_empty() || path.len() > 32 || path.iter().any(|part| part.len() > 4096) {
            return Err(IdeError::invalid("invalid variable path"));
        }
        self.validate(generation, revision)?;
        let id = uuid::Uuid::new_v4().to_string();
        let (reply, result) = oneshot::channel();
        self.pending.lock().insert(id.clone(), reply);
        let _pending = PendingRequest { pending: &self.pending, id: id.clone() };
        let operation = async {
            let data = json!({"jsonrpc":"2.0", "id":id, "method":"inspect", "params":{"path":path}});
            let (reply, sent) = oneshot::channel();
            let mut message: jupyter_protocol::JupyterMessage =
                CommMsg { comm_id: CommId(self.comm_id.clone()), data: data.as_object().unwrap().clone() }.into();
            // Ark correlates RPC replies by the Jupyter parent header. Its RPC
            // id must match the wire message id; ipykernel echoes data.id.
            message.header.msg_id = id.clone();
            self.requests
                .try_send(CommRequest { message, reply })
                .map_err(|_| IdeError::unavailable("session request queue full"))?;
            sent.await.map_err(|_| IdeError::unavailable("session transport closed"))??;
            result.await.map_err(|_| IdeError::unavailable("variables request closed"))?
        };
        let result = tokio::select! {
            biased;
            _ = self.stop.cancelled() => Err(IdeError::cancelled()),
            result = tokio::time::timeout(std::time::Duration::from_secs(10), operation) =>
                result.unwrap_or_else(|_| Err(IdeError::unavailable("variables inspect timed out"))),
        };
        let result = result?;
        self.validate(generation, revision)?;
        Ok(SessionChildren {
            generation: generation.into(),
            revision,
            variables: variables(&result["children"]),
            total: count(&result["length"]),
        })
    }

    fn validate(&self, generation: &str, revision: u32) -> IdeResult<()> {
        let state = self.state.lock();
        if self.stop.is_cancelled() || state.generation != generation || state.revision != revision {
            return Err(IdeError::cancelled());
        }
        Ok(())
    }

    pub(crate) fn error(&self, message: String) {
        self.state.lock().error = Some(message);
    }

    pub(crate) fn owns_comm(&self, id: &str) -> bool {
        id == self.comm_id || self.plot_comms.lock().iter().any(|comm| comm == id)
    }

    pub(crate) fn observe(&self, kind: &str, content: &Value, parent: &str) {
        if self.stop.is_cancelled() {
            return;
        }
        let comm = content["comm_id"].as_str().unwrap_or("");
        if comm == self.comm_id && kind == "comm_msg" {
            let data = &content["data"];
            if let Some(reply) = self.pending.lock().remove(data["id"].as_str().unwrap_or(parent)) {
                let result = if data.get("error").is_some() {
                    Err(IdeError::unavailable("variable is no longer available"))
                } else {
                    Ok(data["result"].clone())
                };
                let _ = reply.send(result);
                return;
            }
            let params = &data["params"];
            let mut state = self.state.lock();
            if matches!(data["method"].as_str(), Some("refresh" | "update")) {
                let version = params["version"].as_u64().unwrap_or(0);
                if version > 0 {
                    let mut previous = self.backend_version.lock();
                    if version <= *previous {
                        return;
                    }
                    *previous = version;
                }
            }
            match data["method"].as_str() {
                Some("refresh") => {
                    state.variables = variables(&params["variables"]);
                    state.total = count(&params["length"]);
                }
                Some("update") => {
                    let removed = params["removed"].as_array();
                    state
                        .variables
                        .retain(|v| !removed.is_some_and(|keys| keys.iter().any(|key| key.as_str() == Some(&v.key))));
                    for v in variables(&params["assigned"]).into_iter().chain(variables(&params["unevaluated"])) {
                        if let Some(old) = state.variables.iter_mut().find(|old| old.key == v.key) {
                            *old = v;
                        } else if state.variables.len() < MAX_VARIABLES {
                            state.variables.push(v);
                        }
                    }
                    state.total = state.variables.len() as u32;
                }
                _ => return,
            }
            state.variables.sort_by(|a, b| a.name.cmp(&b.name));
            state.revision = state.revision.wrapping_add(1);
            state.ready = true;
            state.error = None;
        } else if comm == self.comm_id && kind == "comm_close" {
            self.error("Runtime rejected the variables adapter".into());
        }
        if kind == "comm_open" && content["target_name"] == "positron.plot" {
            let mut comms = self.plot_comms.lock();
            if comms.len() >= MAX_PLOTS {
                comms.remove(0);
            }
            comms.push(comm.to_owned());
            drop(comms);
            self.pre_render(comm, &content["data"]["pre_render"], parent, false);
        } else if kind == "comm_msg" && self.plot_comms.lock().iter().any(|id| id == comm) {
            self.pre_render(comm, &content["data"]["params"]["pre_render"], parent, true);
        } else if matches!(kind, "display_data" | "execute_result" | "update_display_data") {
            let data = &content["data"];
            for mime in ["image/png", "image/jpeg", "image/svg+xml"] {
                if let Some(image) = data[mime].as_str() {
                    let id = content["transient"]["display_id"]
                        .as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                    self.plot(id, mime, image, parent, kind == "update_display_data");
                    break;
                }
            }
        }
    }

    fn pre_render(&self, id: &str, value: &Value, parent: &str, update_only: bool) {
        if let (Some(mime), Some(data)) = (value["mime_type"].as_str(), value["data"].as_str()) {
            self.plot(id.into(), mime, data, parent, update_only);
        }
    }

    fn plot(&self, id: String, mime: &str, data: &str, parent: &str, update_only: bool) {
        if !matches!(mime, "image/png" | "image/jpeg" | "image/svg+xml") || data.len() > MAX_PLOT_BYTES {
            return;
        }
        let mut state = self.state.lock();
        let plot = SessionPlot { id: id.clone(), mime: mime.into(), data: data.into(), execution_id: parent.into() };
        if let Some(old) = state.plots.iter_mut().find(|plot| plot.id == id) {
            *old = plot;
        } else if !update_only {
            state.plots.push(plot);
        }
        let mut plots: VecDeque<_> = std::mem::take(&mut state.plots).into();
        let mut bytes: usize = plots.iter().map(|plot| plot.data.len()).sum();
        while plots.len() > MAX_PLOTS || bytes > MAX_PLOT_BYTES {
            bytes -= plots.pop_front().unwrap().data.len();
        }
        state.plots = plots.into();
    }
}

fn count(value: &Value) -> u32 {
    value.as_u64().unwrap_or(0).min(u32::MAX as u64) as u32
}

fn variables(value: &Value) -> Vec<SessionVariable> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .take(MAX_VARIABLES)
        .filter_map(|value| {
            Some(SessionVariable {
                key: value["access_key"].as_str()?.into(),
                name: value["display_name"].as_str()?.chars().take(256).collect(),
                type_name: value["display_type"].as_str().unwrap_or("").chars().take(256).collect(),
                summary: value["display_value"].as_str().unwrap_or("").chars().take(512).collect(),
                has_children: value["has_children"].as_bool().unwrap_or(false),
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;
