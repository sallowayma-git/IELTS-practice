pub(crate) mod catalog;
mod native;
pub(crate) mod practice;
pub(crate) mod service;

#[cfg(test)]
mod convert;
#[cfg(test)]
const EXAM: &str = include_str!("samples/humans-and-food/03-reading.json");
#[cfg(test)]
const REVIEW: &str = include_str!("samples/humans-and-food/05-review.json");
