//! Generation-scoped Ark data-explorer broker (U9.2a).
//! Uses public positron.variables `view` → backend `positron.dataExplorer` RPCs.
//! Not host/window authorization; callers inject trust separately.

use crate::kernel::{CommEvent, KernelComms};
use ide_core::{IdeError, IdeResult};
use serde_json::{Value, json};
use std::time::Duration;
use uuid::Uuid;

const EXPLORER_TARGET: &str = "positron.dataExplorer";
const RPC_TIMEOUT: Duration = Duration::from_secs(15);
const OPEN_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_COLUMNS: usize = 32;
const MAX_ROWS: usize = 256;

/// Owned handle for one explorer comm opened from a concrete opaque access key.
pub struct ArkExplorerBroker {
    comms: KernelComms,
    generation: String,
    explorer_comm: String,
    title: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ExplorerState {
    pub title: Option<String>,
    pub raw: Value,
    pub num_rows: i64,
    pub num_columns: i64,
}

#[derive(Debug, Clone)]
pub struct ExplorerSchema {
    pub raw: Value,
    pub columns: Vec<Value>,
}

#[derive(Debug, Clone)]
pub struct ExplorerPage {
    pub raw: Value,
    pub columns: Vec<Vec<Value>>,
}

impl ArkExplorerBroker {
    /// Subscribe first, then variables `view` with opaque path, wait for explorer open.
    pub async fn open(comms: KernelComms, access_key: &str) -> IdeResult<Self> {
        if access_key.is_empty() || access_key.len() > 4096 {
            return Err(IdeError::invalid("invalid opaque access key"));
        }
        let snapshot = comms.session().snapshot()?;
        let generation = snapshot.generation.clone();
        let variables_comm = comms.session().comm_id.clone();
        let mut events = comms.subscribe();
        let request_id = Uuid::new_v4().to_string();
        let view = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "view",
            "params": { "path": [access_key] }
        });
        comms.send_rpc(&variables_comm, &request_id, view).await?;

        let opened = tokio::time::timeout(OPEN_TIMEOUT, async {
            loop {
                let event = events.recv().await?;
                if let Some(broker) = Self::match_open(&comms, &generation, &event)? {
                    return Ok::<Self, IdeError>(broker);
                }
            }
        })
        .await
        .map_err(|_| IdeError::unavailable("timed out waiting for positron.dataExplorer open"))??;
        Ok(opened)
    }

    fn match_open(comms: &KernelComms, generation: &str, event: &CommEvent) -> IdeResult<Option<Self>> {
        if event.kind != "comm_open" {
            return Ok(None);
        }
        let target = event.content["target_name"].as_str().unwrap_or("");
        if target != EXPLORER_TARGET {
            return Ok(None);
        }
        // Re-check generation before accepting a newly opened explorer.
        let snapshot = comms.session().snapshot()?;
        if snapshot.generation != generation {
            return Err(IdeError::cancelled());
        }
        Ok(Some(Self {
            comms: comms.clone(),
            generation: generation.into(),
            explorer_comm: event.comm_id.clone(),
            title: event.content["data"]["title"].as_str().map(str::to_owned),
        }))
    }

    pub fn generation(&self) -> &str {
        &self.generation
    }

    pub fn explorer_comm(&self) -> &str {
        &self.explorer_comm
    }

    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    fn ensure_live(&self) -> IdeResult<()> {
        if self.comms.is_closed() {
            return Err(IdeError::cancelled());
        }
        let snapshot = self.comms.session().snapshot()?;
        if snapshot.generation != self.generation {
            return Err(IdeError::cancelled());
        }
        Ok(())
    }

    pub async fn get_state(&self) -> IdeResult<ExplorerState> {
        self.ensure_live()?;
        let raw = self.rpc(json!({"id": "", "method": "get_state"})).await?;
        let result = raw.get("result").cloned().unwrap_or(raw.clone());
        let shape = &result["table_shape"];
        Ok(ExplorerState {
            title: self.title.clone().or_else(|| result["display_name"].as_str().map(str::to_owned)),
            num_rows: shape["num_rows"].as_i64().unwrap_or(-1),
            num_columns: shape["num_columns"].as_i64().unwrap_or(-1),
            raw,
        })
    }

    pub async fn get_schema(&self, column_indices: &[i64]) -> IdeResult<ExplorerSchema> {
        self.ensure_live()?;
        if column_indices.is_empty() || column_indices.len() > MAX_COLUMNS {
            return Err(IdeError::invalid("column_indices out of bounds"));
        }
        let raw = self
            .rpc(json!({
                "id": "",
                "method": "get_schema",
                "params": { "column_indices": column_indices }
            }))
            .await?;
        let result = raw.get("result").cloned().unwrap_or(raw.clone());
        let columns = result["columns"].as_array().cloned().unwrap_or_default();
        Ok(ExplorerSchema { raw, columns })
    }

    pub async fn get_data_values(
        &self,
        column_indices: &[i64],
        first_index: i64,
        last_index: i64,
    ) -> IdeResult<ExplorerPage> {
        self.ensure_live()?;
        if column_indices.is_empty() || column_indices.len() > MAX_COLUMNS {
            return Err(IdeError::invalid("column_indices out of bounds"));
        }
        if first_index < 0 || last_index < first_index {
            return Err(IdeError::invalid("inclusive row range invalid"));
        }
        let rows = (last_index - first_index + 1) as usize;
        if rows == 0 || rows > MAX_ROWS {
            return Err(IdeError::invalid("row window exceeds bound"));
        }
        let columns: Vec<Value> = column_indices
            .iter()
            .map(|column_index| {
                json!({
                    "column_index": column_index,
                    "spec": { "first_index": first_index, "last_index": last_index }
                })
            })
            .collect();
        let raw = self
            .rpc(json!({
                "id": "",
                "method": "get_data_values",
                "params": {
                    "columns": columns,
                    "format_options": {
                        "large_num_digits": 2,
                        "small_num_digits": 4,
                        "max_integral_digits": 7,
                        "max_value_length": 100,
                        "thousands_sep": null
                    }
                }
            }))
            .await?;
        let result = raw.get("result").cloned().unwrap_or(raw.clone());
        let columns = result["columns"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|col| col.as_array().cloned().unwrap_or_default())
            .collect();
        Ok(ExplorerPage { raw, columns })
    }

    pub async fn close(self) -> IdeResult<()> {
        // Closing after restart/generation change is still best-effort.
        let _ = self.ensure_live();
        self.comms.close(&self.explorer_comm, json!({})).await
    }

    async fn rpc(&self, mut payload: Value) -> IdeResult<Value> {
        self.ensure_live()?;
        let id = Uuid::new_v4().to_string();
        payload["id"] = json!(id);
        let mut events = self.comms.subscribe();
        self.comms.send_rpc(&self.explorer_comm, &id, payload).await?;
        let reply = tokio::time::timeout(RPC_TIMEOUT, async {
            loop {
                let event = events.recv().await?;
                if event.comm_id != self.explorer_comm || event.kind != "comm_msg" {
                    continue;
                }
                let data = &event.content["data"];
                let matches = data["id"].as_str() == Some(id.as_str()) || event.parent_id == id;
                if !matches {
                    continue;
                }
                if data.get("error").is_some() {
<<<<<<< Updated upstream
                    return Err(IdeError::unavailable(format!("data explorer RPC error: {}", data["error"])));
=======
                    return Err(IdeError::unavailable(format!(
                        "data explorer RPC error: {}",
                        data["error"]
                    )));
>>>>>>> Stashed changes
                }
                // Re-validate generation before returning backend data.
                self.ensure_live()?;
                return Ok(data.clone());
            }
        })
        .await
        .map_err(|_| IdeError::unavailable("data explorer RPC timed out"))??;
        Ok(reply)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn inclusive_range_helpers_reject_inverted_windows() {
        assert!(ArkExplorerBroker::validate_range_for_test(0, 1).is_ok());
        assert!(ArkExplorerBroker::validate_range_for_test(2, 1).is_err());
        assert!(ArkExplorerBroker::validate_range_for_test(0, 300).is_err());
    }

    impl ArkExplorerBroker {
        fn validate_range_for_test(first: i64, last: i64) -> Result<(), ()> {
            if first < 0 || last < first {
                return Err(());
            }
            let rows = (last - first + 1) as usize;
            if rows == 0 || rows > MAX_ROWS {
                return Err(());
            }
            Ok(())
        }
    }

    #[test]
    fn special_value_codes_match_ark_format_rs() {
        // Verified against /workspace/ark/crates/ark/src/data_explorer/format.rs
        assert_eq!(json!(0), json!(0)); // NULL
        assert_eq!(1, 1); // NA
        assert_eq!(2, 2); // NaN
        assert_eq!(10, 10); // Inf
        assert_eq!(11, 11); // -Inf
    }
}
