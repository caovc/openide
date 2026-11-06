//! LSP for an already-owned kernel session. Never launches a server process.
use ide_core::{CancellationToken, IdeError, IdeResult, Pos, Range};
use ide_jsonrpc::{Handler, Peer};
use lsp_types as lsp;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use specta::Type;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::Mutex;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SessionFeature {
    Hover,
    Completion,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionCompletion {
    pub label: String,
    pub detail: Option<String>,
    pub text: String,
    pub snippet: bool,
    pub range: Option<Range>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SessionReply {
    Hover { text: Option<String> },
    Completion { items: Vec<SessionCompletion> },
}

struct SessionHandler;
impl Handler for SessionHandler {
    fn on_notification(&self, _: &str, _: Value) {}
    fn on_request(&self, method: &str, params: Value) -> Result<Value, (i64, String)> {
        match method {
            "workspace/configuration" => {
                Ok(json!(params["items"].as_array().map(|items| vec![Value::Null; items.len()]).unwrap_or_default()))
            }
            "client/registerCapability" | "window/workDoneProgress/create" => Ok(Value::Null),
            _ => Err((-32601, format!("unsupported session LSP request: {method}"))),
        }
    }
}

pub struct SessionLsp {
    peer: Peer,
    stop: CancellationToken,
    // Serialize sync + query so a request always observes its supplied text.
    documents: Mutex<HashMap<String, (i32, String)>>,
}

fn rpc_error(error: impl std::fmt::Display) -> IdeError {
    IdeError::unavailable(format!("Ark session LSP: {error}"))
}

impl Drop for SessionLsp {
    fn drop(&mut self) {
        self.peer.kill();
    }
}

impl SessionLsp {
    /// `port` must come from this kernel's positron.lsp comm, never configuration.
    pub async fn connect(port: u16, stop: CancellationToken) -> IdeResult<Self> {
        let stream = tokio::select! {
            biased;
            _ = stop.cancelled() => return Err(IdeError::cancelled()),
            stream = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)) => stream.map_err(rpc_error)?,
        };
        let (read, write) = stream.into_split();
        let peer = Peer::connect(read, write, Arc::new(SessionHandler));
        let session = Self { peer, stop, documents: Mutex::new(HashMap::new()) };
        let initialized: Value = tokio::time::timeout(
            Duration::from_secs(30),
            session.peer.request(
                "initialize",
                json!({"processId":std::process::id(),"rootUri":null,"workspaceFolders":null,
                "capabilities":{"general":{"positionEncodings":["utf-16"]},
                "textDocument":{"completion":{"completionItem":{"snippetSupport":true}}}}}),
                Some(session.stop.clone()),
            ),
        )
        .await
        .map_err(rpc_error)?
        .map_err(rpc_error)?;
        if initialized["serverInfo"]["name"] != "Ark R Kernel" {
            return Err(rpc_error("endpoint is not Ark R Kernel"));
        }
        if initialized["capabilities"]["positionEncoding"].as_str().is_some_and(|s| s != "utf-16") {
            return Err(rpc_error("endpoint did not select UTF-16"));
        }
        session.peer.notify("initialized", json!({})).map_err(rpc_error)?;
        let peer = session.peer.clone();
        let stop = session.stop.clone();
        tokio::spawn(async move {
            tokio::select! {
                _ = stop.cancelled() => peer.kill(),
                _ = peer.closed() => {},
            }
        });
        Ok(session)
    }

    pub async fn query(
        &self,
        uri: &str,
        text: &str,
        position: Pos,
        feature: SessionFeature,
        cancel: CancellationToken,
    ) -> IdeResult<SessionReply> {
        if text.len() > 8 * 1024 * 1024 {
            return Err(IdeError::invalid("R cell source exceeds 8 MiB"));
        }
        let line = text
            .split('\n')
            .nth(position.line as usize)
            .ok_or_else(|| IdeError::invalid("R cell position line is out of bounds"))?;
        if position.col as usize > line.encode_utf16().count() {
            return Err(IdeError::invalid("R cell UTF-16 column is out of bounds"));
        }
        tokio::select! {
            biased;
            _ = self.stop.cancelled() => Err(IdeError::cancelled()),
            _ = cancel.cancelled() => Err(IdeError::cancelled()),
            result = tokio::time::timeout(Duration::from_secs(30), self.query_inner(uri, text, position, feature, cancel.clone())) => result.map_err(rpc_error)?,
        }
    }

    async fn query_inner(
        &self,
        uri: &str,
        text: &str,
        position: Pos,
        feature: SessionFeature,
        cancel: CancellationToken,
    ) -> IdeResult<SessionReply> {
        let mut documents = self.documents.lock().await;
        if self.stop.is_cancelled() {
            return Err(IdeError::cancelled());
        }
        match documents.get_mut(uri) {
            Some((version, old)) if old != text => {
                *version += 1;
                self.peer
                    .notify(
                        "textDocument/didChange",
                        json!({"textDocument":{"uri":uri,"version":version},"contentChanges":[{"text":text}]}),
                    )
                    .map_err(rpc_error)?;
                *old = text.into();
            }
            Some(_) => {}
            None => {
                self.peer
                    .notify(
                        "textDocument/didOpen",
                        json!({"textDocument":{"uri":uri,"languageId":"r","version":1,"text":text}}),
                    )
                    .map_err(rpc_error)?;
                documents.insert(uri.into(), (1, text.into()));
            }
        }
        let method = match feature {
            SessionFeature::Hover => "textDocument/hover",
            SessionFeature::Completion => "textDocument/completion",
        };
        let value: Value = self
            .peer
            .request(
                method,
                json!({"textDocument":{"uri":uri},"position":{"line":position.line,"character":position.col}}),
                Some(cancel),
            )
            .await
            .map_err(rpc_error)?;
        match feature {
            SessionFeature::Hover => {
                let hover: Option<lsp::Hover> = serde_json::from_value(value).map_err(rpc_error)?;
                let text = hover.map(|hover| match hover.contents {
                    lsp::HoverContents::Markup(content) => content.value,
                    lsp::HoverContents::Scalar(content) => marked(content),
                    lsp::HoverContents::Array(contents) => {
                        contents.into_iter().map(marked).collect::<Vec<_>>().join("\n\n")
                    }
                });
                Ok(SessionReply::Hover { text })
            }
            SessionFeature::Completion => {
                let response: Option<lsp::CompletionResponse> = serde_json::from_value(value).map_err(rpc_error)?;
                let items = match response {
                    Some(lsp::CompletionResponse::Array(items)) => items,
                    Some(lsp::CompletionResponse::List(list)) => list.items,
                    None => Vec::new(),
                };
                Ok(SessionReply::Completion {
                    items: items
                        .into_iter()
                        .filter_map(|item| {
                            // Additional edits are not supported by the cell completion adapter.
                            if item.additional_text_edits.as_ref().is_some_and(|edits| !edits.is_empty()) {
                                return None;
                            }
                            let (text, range) = match item.text_edit {
                                Some(lsp::CompletionTextEdit::Edit(edit)) => (edit.new_text, Some(edit.range)),
                                Some(lsp::CompletionTextEdit::InsertAndReplace(edit)) => {
                                    (edit.new_text, Some(edit.replace))
                                }
                                None => (item.insert_text.unwrap_or_else(|| item.label.clone()), None),
                            };
                            Some(SessionCompletion {
                                label: item.label,
                                detail: item.detail,
                                text,
                                snippet: item.insert_text_format == Some(lsp::InsertTextFormat::SNIPPET),
                                range: range.map(|r| {
                                    Range::new(
                                        Pos::new(r.start.line, r.start.character),
                                        Pos::new(r.end.line, r.end.character),
                                    )
                                }),
                            })
                        })
                        .collect(),
                })
            }
        }
    }
}

fn marked(content: lsp::MarkedString) -> String {
    match content {
        lsp::MarkedString::String(text) => text,
        lsp::MarkedString::LanguageString(content) => content.value,
    }
}
