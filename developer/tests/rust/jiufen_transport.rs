//! Per-session fault injection. Never compiled into the shipping application.
use super::{Failure, Value};
use std::{future::Future, pin::Pin, sync::Arc};

type Response = Pin<Box<dyn Future<Output = Result<Value, Failure>> + Send>>;

#[derive(Clone)]
pub(super) struct Transport(Arc<dyn Fn(String, Option<Value>) -> Response + Send + Sync>);

impl Transport {
    pub(super) fn new<F, Fut>(request: F) -> Self
    where
        F: Fn(String, Option<Value>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Value, Failure>> + Send + 'static,
    {
        Self(Arc::new(move |path, body| Box::pin(request(path, body))))
    }

    pub(super) async fn request(&self, path: &str, body: Option<&Value>) -> Result<Value, Failure> {
        (self.0)(path.to_owned(), body.cloned()).await
    }
}
